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
SCRATCH = FRONTEND / ".verification" / ("ui-documents-negative-" + uuid.uuid4().hex[:12])
fixture.SCRATCH = SCRATCH
RESULTS, FAILURES = v.RESULTS, v.FAILURES
BASE = ""

def scenario(browser, shots):
    v.BASE = BASE
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    errors, downloads, writes, workspace_writes = [], [], [], []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("download", lambda download: downloads.append(download.suggested_filename))
    fixture.login(page, BASE, USERNAME, PASSWORD)
    def record(request):
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            target = request.url.split("?")[0].split("/api/v1/")[-1]
            entry = request.method + " " + target
            if request.method == "PUT" and target == "workspace/state":
                workspace_writes.append(entry)
            else:
                writes.append(entry)
    page.on("request", record)
    try:
        v.capture_job_failure(page, shots)
        completed = {"id":"job-negative-completed", "status":"completed", "total":1,
            "processed":1, "errors":[], "createdAt":"2026-01-15T10:00:00Z",
            "documents":[{"id":"document-negative", "filename":"report.pdf", "mimeType":"application/pdf",
              "downloadUrl":"/api/v1/documents/document-negative/download"}]}
        def listing(route):
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"items":[completed]}))
        def detail(route):
            route.fulfill(status=200, content_type="application/json", body=json.dumps({"job":completed}))
        page.route("**/api/v1/reports/jobs?*", listing)
        page.route("**/api/v1/reports/jobs/job-negative-completed*", detail)
        original_download_check = v.check_download_failure
        def localized_download_check(page, locale, theme, width):
            # The reused check reloads. Persist the selected locale first.
            page.evaluate("tag => window.ItsmI18n.setLocale(tag, {persist:true})", locale)
            result = original_download_check(page, locale, theme, width)
            actual = page.evaluate("window.ItsmI18n.locale")
            # Visible heading, not a potentially differently shaped runtime getter.
            heading = page.locator('[data-od-id="reports-center"] h1').inner_text()
            assert heading == ("Reports" if locale == "en" else "Reportes"), heading
            alert = page.locator('.doc-job-alert[role="alert"]').inner_text()
            expected = v.CATALOG[locale]['ui.errors.request_failed']
            assert expected in alert, f"Unlocalized download failure: {alert!r}, expected {expected!r}"
            return result
        v.check_download_failure = localized_download_check
        try:
            v.capture_download_failure(page, shots)
        finally:
            v.check_download_failure = original_download_check
        assert not downloads, "Aborted download unexpectedly saved a file"
        assert not writes, "Unexpected mutation after login: " + repr(writes)
        assert not errors, "Page errors: " + repr(errors)
        print(f"NEGATIVE_PROOF document_mutations=0 workspace_navigation_writes={len(workspace_writes)} downloads=0 pageerrors=0 source=READ-fixture-not-real-document")
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
