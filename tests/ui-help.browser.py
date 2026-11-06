"""Isolated READ-fixture proof of failed report jobs and aborted downloads.
No report generation or document persistence is exercised by this proof.
"""
import importlib.util
from pathlib import Path
import sys
import json
import uuid
_spec = importlib.util.spec_from_file_location("documents_visual", Path(__file__).with_name("ui-documents-visual.browser.py"))
v = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(v)
fixture, PYTHON, BACKEND, FRONTEND = v.fixture, v.PYTHON, v.BACKEND, v.FRONTEND
USERNAME, PASSWORD = v.USERNAME, v.PASSWORD
SCRATCH = FRONTEND / ".verification" / ("ui-help-" + uuid.uuid4().hex[:12])
fixture.SCRATCH = SCRATCH
RESULTS, FAILURES = v.RESULTS, v.FAILURES
BASE = ""

def scenario(browser, shots):
    v.BASE = BASE
    context = browser.new_context(viewport={"width":1440,"height":1000})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    fixture.login(page, BASE, USERNAME, PASSWORD)
    try:
        v.capture(page, shots, "help", "#/ayuda", ".help-page", v.SETTINGS_CELLS,
                  lambda page, locale, theme, width: "isolated real installation; help route")
        def filtered(page, locale, theme, width):
            page.locator('#help-search').fill('inventario' if locale == 'es' else 'inventory')
            page.wait_for_function("() => document.querySelectorAll('.help-topic').length > 0 && document.querySelectorAll('.help-topic').length < 9")
            return f"filtered topics={page.locator('.help-topic').count()}"
        def empty(page, locale, theme, width):
            page.locator('#help-search').fill('zz-no-help-topic-999')
            page.wait_for_function("() => document.querySelectorAll('.help-topic').length === 0")
            expected = v.CATALOG[locale]['ui.help.empty']
            assert expected in page.locator('.help-page').inner_text()
            return "unmatched search; localized empty state"
        v.capture(page, shots, 'help-search-results', '#/ayuda', '.help-page', v.SETTINGS_CELLS, filtered)
        v.capture(page, shots, 'help-search-empty', '#/ayuda', '.help-page', v.SETTINGS_CELLS, empty)
        assert not errors, errors
        print("HELP_PROOF pageerrors=0")
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
             "--username", USERNAME, "--name", "UI people install"],
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
    print("RESULT all document checks passed")
    return 1 if failed else 0



if __name__ == "__main__":
    sys.exit(main())
