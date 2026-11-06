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
SCRATCH = FRONTEND / ".verification" / ("ui-config-services-" + uuid.uuid4().hex[:12])
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
        for section in ('alertas', 'notificaciones', 'mapas', 'datos'):
            v.capture(page, shots, 'config-'+section, '#/configuracion/'+section,
                      '.config-page', v.SETTINGS_CELLS,
                      lambda page, locale, theme, width: check_route(page, section))
        assert not errors, errors
        print("CONFIG_PROOF pageerrors=0")
    finally:
        context.close()

PROTOTYPE_PLAN_NAMES = ('Administración', 'Diseño', 'Recepción y acceso',
                         'Producción y operaciones', 'Sala técnica · racks')


def check_route(page, section):
    if section == 'mapas':
        # The settings view must be mounted before its content is asserted, so a
        # missing or misnamed root cannot pass as an empty canonical state.
        settings = page.locator('.map-config')
        assert settings.count() == 1, 'Map settings root .map-config is missing'
        table = settings.locator('.map-plan-table')
        assert table.count() == 1, 'Canonical plan table is missing'
        assert table.locator('tbody tr').count() == 0, 'Prototype plans leaked'
        text = settings.inner_text()
        assert '28' not in text and '23' not in text, 'Prototype asset/position counts leaked'
        for name in PROTOTYPE_PLAN_NAMES:
            assert name not in text, 'Prototype plan name leaked: ' + name
        # Positive canonical proof: an empty install renders zero server sites,
        # buildings, plans and positioned assets, in either locale.
        assert '0 sedes y 0 edificios' in text or '0 sites and 0 buildings' in text, text
        assert '0 de 0 activos' in text or '0 of 0 assets' in text, text
        assert settings.locator('.map-site-form').count() == 0, 'Prototype sites leaked'
        # Installed mode has no supported canonical writer on this surface, so
        # prototype-only mutations must not render as usable controls.
        assert settings.locator('[data-od-id="map-settings-server-notice"]').count() == 1, 'Missing server-data notice'
        assert settings.locator('.map-site-form input').count() == 0, 'Site coordinate inputs are usable in installed mode'
        assert settings.locator('[data-od-id="map-settings-add-plan"]').count() == 0, 'Add plan control is usable in installed mode'
        assert table.locator('input').count() == 0, 'Plan visibility/opacity controls are usable in installed mode'
        assert settings.locator('[data-od-id="map-settings-positions"] button').count() == 0, 'Clear positions control is usable in installed mode'
        # Local display preferences stay interactive; they are browser-only.
        assert settings.locator('[data-od-id="map-settings-prefs"] input[type="checkbox"]').count() >= 4, 'Display preferences are not usable'
    return 'read-only route visit; no settings saved'

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
