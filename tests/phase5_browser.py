"""Fase 5 — organización con autoridad del servidor, extremo a extremo.

Arranca su propio uvicorn en loopback con una SQLite temporal y migrada, un
administrador desechable y el servidor Vite; conduce la interfaz Vue real en
Chromium y comprueba los efectos persistidos por la API pública (no que un
diálogo se haya cerrado). Sólo detiene los procesos que creó.

Requiere playwright + Chromium en el equipo. Sin archivo .env, sin Docker y sin
tocar bases de datos existentes. Los puertos son propios y efímeros y el archivo
de la cola Huey también queda dentro del directorio temporal de la corrida.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
# The canonical backend checkout can be busy with another unit's work, so this
# run uses a read-only export of the accepted commit. `ITSM_PHASE5_BACKEND_ROOT`
# is the explicit escape hatch for someone who wants to test another checkout.
CANONICAL_BACKEND = Path(os.environ.get('ITSM_PHASE5_BACKEND') or ROOT.parent / 'backend')
PINNED_BACKEND_COMMIT = '62209b9'
PYTHON = CANONICAL_BACKEND / '.venv' / 'bin' / 'python'


def pinned_backend():
    """A read-only export of the accepted backend commit.

    `git archive` only reads the canonical repository and writes into the
    ignored `.verification/` directory; the source checkout, its index and its
    branches are left untouched.
    """
    override = os.environ.get('ITSM_PHASE5_BACKEND_ROOT')
    if override:
        root = Path(override).resolve()
        assert (root / 'itsm' / 'main.py').exists(), 'ITSM_PHASE5_BACKEND_ROOT has no itsm package: %s' % root
        return root
    target = ROOT / '.verification' / ('backend-' + PINNED_BACKEND_COMMIT)
    if not (target / 'itsm' / 'main.py').exists():
        target.mkdir(parents=True, exist_ok=True)
        archive = target.parent / ('backend-' + PINNED_BACKEND_COMMIT + '.tar')
        subprocess.run(['git', '-C', str(CANONICAL_BACKEND), 'archive', '--format=tar',
                        '-o', str(archive), PINNED_BACKEND_COMMIT], check=True)
        subprocess.run(['tar', '-x', '-f', str(archive), '-C', str(target)], check=True)
        archive.unlink()
    return target


BACKEND = pinned_backend()
USERNAME = 'phase5.admin'
PASSWORD = 'Phase5-Smoke-Pass-7k'
suffix = uuid.uuid4().hex[:6]
SITE_NAME = 'Sede F5 ' + suffix
BUILDING_NAME = 'Edificio Norte ' + suffix
FLOOR_NAME = 'Piso 2 ' + suffix
ROOM_NAME = 'Sala tecnica ' + suffix
DEPARTMENT_NAME = 'Operaciones ' + suffix
PERSON_NAME = 'Ana F5 ' + suffix
ASSET_A = 'Servidor F5 ' + suffix
ASSET_B = 'Switch F5 ' + suffix
HOST_C = 'Host alternativo F5 ' + suffix
VIEWER_USERNAME = 'phase5.viewer.' + suffix
VIEWER_PASSWORD = 'Phase5-Viewer-Pass-7k2'

owned = []


def free_port():
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


API_PORT = free_port()
WEB_PORT = free_port()
BASE = 'http://127.0.0.1:%d' % WEB_PORT
API = 'http://127.0.0.1:%d' % API_PORT


def wait_for(url, timeout=90):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=2)
            return
        except Exception:
            time.sleep(0.4)
    raise RuntimeError('timeout waiting for ' + url)


def stop_owned():
    for process in reversed(owned):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()


def run_env(database, task_database):
    # Scrub every inherited ITSM_* variable first so an outer shell cannot point
    # this run at another database, origin or storage.
    env = {key: value for key, value in os.environ.items() if not key.startswith('ITSM_')}
    env.update({
        'ITSM_DATABASE_URL': 'sqlite+pysqlite:///' + str(database),
        # The SQLite task queue default lives outside the scratch directory and
        # must not be shared; pin it next to the temporary application database.
        'ITSM_TASK_SQLITE_PATH': str(task_database),
        'ITSM_ENVIRONMENT': 'development',
        'ITSM_AUTH_ORIGIN': BASE,
        'ITSM_AUTH_COOKIE_SECURE': 'false',
        'ITSM_BOOTSTRAP_PASSWORD': PASSWORD,
        'ITSM_DEV_API_URL': API,
        'ITSM_AGENT_MODEL': '',
        'ITSM_TASK_STORAGE': 'sqlite',
        'ITSM_PROMETHEUS_URL': '',
        'ITSM_MEILISEARCH_URL': '',
        'ITSM_SERVICE_REDIS_URL': '',
        # The exported backend is not the checkout uvicorn runs from, so its
        # package path is explicit and the canonical source is never imported.
        'PYTHONPATH': str(BACKEND),
    })
    return env


API_JS = """
async (args) => {
  const session = await (await fetch('/api/v1/auth/me', { credentials: 'same-origin' })).json();
  const headers = { 'Content-Type': 'application/json' };
  if (args.method && args.method !== 'GET') headers['X-CSRF-Token'] = session.csrfToken;
  const payload = args.body === null || args.body === undefined ? undefined : JSON.stringify(args.body);
  const response = await fetch('/api/v1' + args.path, {
    method: args.method || 'GET',
    credentials: 'same-origin',
    headers,
    body: payload,
  });
  let body = null;
  try { body = await response.json(); } catch (error) { body = null; }
  return { status: response.status, body };
}
"""


def api(page, path, method='GET', body=None):
    result = page.evaluate(API_JS, {'path': path, 'method': method, 'body': body})
    assert result['status'] < 400, '%s %s -> %s %s' % (method, path, result['status'], result['body'])
    return result['body']


def create_asset(page, name):
    """Create one asset through the existing Vue editor and prove it persisted."""
    page.goto(BASE + '/#/inventario', wait_until='networkidle')
    page.locator('[data-od-id="create-asset"]').click()
    dialog = page.get_by_role('dialog')
    expect(dialog).to_be_visible()
    dialog.locator('#asset-quick-name').fill(name)
    category = dialog.locator('#asset-editor-category')
    options = [value.strip() for value in category.locator('option').all_inner_texts() if value.strip()]
    assert options, 'the server catalog exposed no category for the editor'
    category.select_option(index=1 if len(options) > 1 else 0)
    dialog.get_by_role('button', name='Registrar activo', exact=True).click()
    try:
        expect(page.get_by_role('dialog')).to_have_count(0, timeout=15000)
    except AssertionError:
        raise AssertionError('asset editor kept open: ' + dialog.inner_text()[:600])
    payload = api(page, '/assets?limit=50&offset=0')
    assert any(item['name'] == name for item in payload['items']), 'asset %r was not persisted' % name


def open_floor(page):
    """Expand the canonical site -> building and open the real floor plan."""
    page.goto(BASE + '/#/infra/mapa', wait_until='networkidle')
    site_toggle = page.locator('.loc-tree__site').filter(has_text=SITE_NAME).first.locator('.loc-tree__toggle')
    expect(site_toggle).to_be_visible()
    if site_toggle.get_attribute('aria-expanded') != 'true':
        site_toggle.click()
    building_button = page.locator('.loc-tree__building').filter(has_text=BUILDING_NAME).first
    expect(building_button).to_be_visible()
    # A single building opens automatically once its site expands; clicking it
    # again would close the floor list this helper needs.
    if building_button.get_attribute('aria-expanded') != 'true':
        building_button.click()
    floor_button = page.locator('.loc-tree__floor').filter(has_text=FLOOR_NAME).first
    expect(floor_button).to_be_visible()
    floor_button.click()
    expect(floor_button).to_have_attribute('aria-current', 'true')
    expect(page.locator('.floor-marker').first).to_be_visible()
    return floor_button


def main():
    workdir = Path(tempfile.mkdtemp(prefix='phase5-browser-'))
    database = workdir / 'phase5.db'
    task_database = workdir / 'phase5-tasks.db'
    env = run_env(database, task_database)
    try:
        subprocess.run([str(PYTHON), '-m', 'alembic', 'upgrade', 'head'], cwd=BACKEND, env=env, check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        subprocess.run([str(PYTHON), '-m', 'itsm.identity.cli', 'bootstrap-admin', '--username', USERNAME,
                        '--name', 'Fase 5 Smoke'], cwd=BACKEND, env=env, check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        uvicorn = subprocess.Popen([str(PYTHON), '-m', 'uvicorn', 'itsm.main:app', '--host', '127.0.0.1',
                                    '--port', str(API_PORT), '--log-level', 'warning'], cwd=BACKEND, env=env)
        owned.append(uvicorn)
        wait_for(API + '/api/v1/health/live')
        vite = subprocess.Popen(['npm', 'run', 'dev', '--', '--port', str(WEB_PORT), '--strictPort'],
                                cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
        owned.append(vite)
        wait_for(BASE + '/index.html')

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context(viewport={'width': 1440, 'height': 1000})
            page = context.new_page()
            failures = []
            console = []
            page.on('pageerror', lambda error: failures.append(str(error)))
            page.on('console', lambda message: console.append(message.text) if message.type == 'error' else None)

            page.goto(BASE + '/#/login', wait_until='networkidle')
            page.get_by_label('Usuario', exact=True).fill(USERNAME)
            page.get_by_label('Contraseña', exact=True).fill(PASSWORD)
            page.get_by_role('button', name='Entrar', exact=True).click()
            expect(page.locator('.app-shell')).to_be_visible()
            console.clear()  # the pre-login session probe answers 401 by design

            # 1. Department through the configuration UI.
            page.goto(BASE + '/#/configuracion/personas', wait_until='networkidle')
            expect(page.get_by_role('heading', name='Personas y departamentos', exact=True)).to_be_visible()
            page.get_by_role('button', name='Nuevo departamento', exact=True).click()
            department_dialog = page.get_by_role('dialog')
            department_dialog.locator('#department-label').fill(DEPARTMENT_NAME)
            department_dialog.get_by_role('button', name='Crear departamento', exact=True).click()
            expect(page.get_by_role('dialog')).to_have_count(0, timeout=20000)
            page.reload(wait_until='networkidle')
            expect(page.get_by_role('article').filter(has_text=DEPARTMENT_NAME).first).to_be_visible()
            departments = api(page, '/departments?limit=200&offset=0')
            department = next(item for item in departments['items'] if item['name'] == DEPARTMENT_NAME)
            assert department['active'] is True

            # 2. Full site → building → floor → room hierarchy through the UI.
            page.goto(BASE + '/#/configuracion/sedes', wait_until='networkidle')
            expect(page.get_by_role('heading', name='Sedes y ubicaciones', exact=True)).to_be_visible()
            page.get_by_role('button', name='Nueva sede', exact=True).first.click()
            site_dialog = page.get_by_role('dialog')
            site_dialog.locator('#org-location-name').fill(SITE_NAME)
            site_dialog.locator('#org-location-latitude').fill('-25.28')
            site_dialog.locator('#org-location-longitude').fill('-57.63')
            site_dialog.get_by_role('button', name='Guardar ubicación', exact=True).click()
            expect(page.get_by_role('dialog')).to_have_count(0, timeout=20000)
            expect(page.get_by_role('article').filter(has_text=SITE_NAME).first).to_be_visible()

            page.get_by_role('button', name='Añadir edificio en ' + SITE_NAME, exact=True).click()
            building_dialog = page.get_by_role('dialog')
            building_dialog.locator('#org-location-name').fill(BUILDING_NAME)
            building_dialog.get_by_role('button', name='Guardar ubicación', exact=True).click()
            expect(page.get_by_role('dialog')).to_have_count(0, timeout=20000)
            expect(page.locator('.location-branch').filter(has_text=BUILDING_NAME).first).to_be_visible()

            page.get_by_role('button', name='Añadir piso en ' + BUILDING_NAME, exact=True).click()
            floor_dialog = page.get_by_role('dialog')
            floor_dialog.locator('#org-location-name').fill(FLOOR_NAME)
            floor_dialog.locator('#org-location-plan-ref').fill('plano-f5.pdf')
            floor_dialog.locator('#org-location-plan-page').fill('2')
            floor_dialog.get_by_role('button', name='Guardar ubicación', exact=True).click()
            expect(page.get_by_role('dialog')).to_have_count(0, timeout=20000)

            page.get_by_role('button', name='Añadir sala o zona en ' + FLOOR_NAME, exact=True).click()
            room_dialog = page.get_by_role('dialog')
            room_dialog.locator('#org-location-name').fill(ROOM_NAME)
            room_dialog.get_by_role('button', name='Guardar ubicación', exact=True).click()
            expect(page.get_by_role('dialog')).to_have_count(0, timeout=20000)
            expect(page.locator('.location-row--room').filter(has_text=ROOM_NAME).first).to_be_visible()

            locations = api(page, '/locations?limit=200&offset=0')
            by_name = {item['name']: item for item in locations['items']}
            site = by_name[SITE_NAME]
            building = by_name[BUILDING_NAME]
            floor = by_name[FLOOR_NAME]
            room = by_name[ROOM_NAME]
            assert building['parentId'] == site['id'] and building['level'] == 'building'
            assert floor['parentId'] == building['id'] and floor['level'] == 'floor'
            assert room['parentId'] == floor['id'] and room['level'] == 'room_zone'
            assert floor['planRef'] == 'plano-f5.pdf' and floor['planPage'] == '2'
            assert site['latitude'] == -25.28 and site['longitude'] == -57.63
            page.screenshot(path=str(workdir / 'config-sedes-1440-light.png'), full_page=True)

            # 3. Person from the directory UI, linked to the real department/site.
            page.goto(BASE + '/#/personas', wait_until='networkidle')
            page.get_by_role('button', name='Nueva persona', exact=True).first.click()
            person_dialog = page.get_by_role('dialog')
            person_dialog.locator('#person-name').fill(PERSON_NAME)
            person_dialog.locator('#person-role').fill('Analista de infraestructura')
            person_dialog.locator('#person-department').select_option(value=department['id'])
            person_dialog.locator('#person-site').select_option(value=site['id'])
            person_dialog.get_by_role('button', name='Crear persona', exact=True).click()
            expect(page.get_by_role('dialog')).to_have_count(0, timeout=20000)
            people = api(page, '/people?limit=50&offset=0&query=' + PERSON_NAME.replace(' ', '%20'))
            person = next(item for item in people['items'] if item['name'] == PERSON_NAME)
            assert person['departmentId'] == department['id'] and person['siteId'] == site['id']
            page.goto(BASE + '/#/persona/' + person['id'], wait_until='networkidle')
            expect(page.get_by_text(PERSON_NAME).first).to_be_visible()
            expect(page.get_by_role('heading', name='Historial de la persona', exact=True)).to_be_visible()

            # 4. Two real assets, then assignment/return/reassignment from the asset sheet.
            create_asset(page, ASSET_A)
            create_asset(page, ASSET_B)
            inventory = api(page, '/assets?limit=50&offset=0')
            asset_a = next(item for item in inventory['items'] if item['name'] == ASSET_A)
            asset_b = next(item for item in inventory['items'] if item['name'] == ASSET_B)
            permanent_id = asset_a['id']
            technical_before = {key: asset_a.get(key) for key in ('serial', 'ip', 'category')}

            page.goto(BASE + '/#/activo/' + permanent_id, wait_until='networkidle')
            expect(page.get_by_role('heading', name='Historial del servidor', exact=True)).to_be_visible()

            page.locator('[data-od-id="assign-asset"]').click()
            assign_dialog = page.get_by_role('dialog')
            expect(assign_dialog).to_be_visible()
            assign_dialog.locator('.assign-option').filter(has_text=PERSON_NAME).first.click()
            assign_dialog.get_by_label('Motivo', exact=False).first.fill('Entrega inicial de fase 5')
            assign_dialog.get_by_role('button', name='Guardar responsable', exact=True).click()
            expect(page.get_by_role('dialog')).to_have_count(0, timeout=20000)
            assigned = api(page, '/assets/' + permanent_id)
            assert assigned['responsiblePersonId'] == person['id'], assigned

            page.locator('[data-od-id="return-asset"]').click()
            return_dialog = page.get_by_role('dialog')
            return_dialog.get_by_label('Motivo', exact=False).first.fill('Devolución temporal')
            return_dialog.get_by_role('button', name='Guardar responsable', exact=True).click()
            expect(page.get_by_role('dialog')).to_have_count(0, timeout=20000)
            returned = api(page, '/assets/' + permanent_id)
            assert not returned['responsiblePersonId'], returned

            page.locator('[data-od-id="assign-asset"]').click()
            reassign_dialog = page.get_by_role('dialog')
            reassign_dialog.locator('.assign-option').filter(has_text=PERSON_NAME).first.click()
            reassign_dialog.get_by_role('button', name='Guardar responsable', exact=True).click()
            expect(page.get_by_role('dialog')).to_have_count(0, timeout=20000)
            reassigned = api(page, '/assets/' + permanent_id)
            assert reassigned['responsiblePersonId'] == person['id'], reassigned

            # 5. Transfer with destination, reason and a different effective date.
            page.locator('[data-od-id="transfer-asset"]').click()
            transfer_dialog = page.get_by_role('dialog')
            transfer_dialog.locator('#transfer-site').select_option(value=site['id'])
            transfer_dialog.locator('#transfer-location').select_option(value=floor['id'])
            transfer_dialog.locator('#transfer-reason').fill('Mudanza al edificio norte')
            transfer_dialog.locator('#transfer-notes').fill('Coordinado con operaciones')
            transfer_dialog.locator('#transfer-effective').fill('2026-03-01T09:00')
            transfer_dialog.get_by_role('button', name='Trasladar activo', exact=True).click()
            expect(page.get_by_role('dialog')).to_have_count(0, timeout=20000)

            transferred = api(page, '/assets/' + permanent_id)
            assert transferred['siteId'] == site['id'], transferred
            assert transferred['locationId'] == floor['id'], transferred
            assert transferred['id'] == permanent_id
            # The server owns the quick code and may reallocate it on a transfer;
            # the permanent identifier and the technical fields stay stable.
            assert isinstance(transferred['quickCode'], str) and transferred['quickCode'].strip()
            for key, value in technical_before.items():
                if value:
                    assert transferred.get(key) == value, (key, transferred.get(key), value)
            history = api(page, '/assets/' + permanent_id + '/history?limit=25&offset=0')
            actions = [item['action'] for item in history['items']]
            assert 'assigned' in actions and 'returned' in actions and 'transferred' in actions, actions
            movement = next(item for item in history['items'] if item['action'] == 'transferred')
            assert movement['reason'] == 'Mudanza al edificio norte'
            assert movement['notes'] == 'Coordinado con operaciones'
            assert movement['effectiveAt'] and movement['source'] == 'rest' and movement['entityType'] == 'asset'
            assert movement['changes']['location_id']['new'] == floor['id'], movement['changes']

            page.reload(wait_until='networkidle')
            expect(page.get_by_role('heading', name='Historial del servidor', exact=True)).to_be_visible()
            detail_history = page.locator('.asset-history').inner_text()
            assert 'Activo trasladado' in detail_history, detail_history
            assert 'Responsable asignado' in detail_history, detail_history
            assert 'Origen: rest' in detail_history, detail_history
            assert 'Mudanza al edificio norte' in detail_history, detail_history
            page.screenshot(path=str(workdir / 'activo-historial-1440-light.png'), full_page=True)

            # 5b. The person sheet assigns an asset from its own picker: the
            # server audit fields and the asset list are visible together.
            page.goto(BASE + '/#/persona/' + person['id'], wait_until='networkidle')
            page.get_by_role('button', name='Asignar activo', exact=True).first.click()
            person_sheet = page.get_by_role('dialog')
            expect(person_sheet.get_by_role('group', name='Activos sin responsable')).to_be_visible()
            expect(person_sheet.get_by_label('Motivo', exact=False).first).to_be_visible()
            person_sheet.locator('.assign-option').filter(has_text=ASSET_B).first.click()
            person_sheet.get_by_label('Motivo', exact=False).first.fill('Asignación desde la ficha de la persona')
            # The person sheet selects an asset, so the dialog keeps its asset
            # footer action; the person is the fixed target of the request.
            person_sheet.get_by_role('button', name='Asignar activo', exact=True).click()
            expect(page.get_by_role('dialog')).to_have_count(0, timeout=20000)
            b_assigned = api(page, '/assets/' + asset_b['id'])
            assert b_assigned['responsiblePersonId'] == person['id'], b_assigned

            # 6. Typed directed relation created from the real form. The typed
            # target text asks the server for a bounded page, not the single page
            # the form opened with.
            page.goto(BASE + '/#/activo/' + asset_a['id'], wait_until='networkidle')
            expect(page.get_by_role('heading', name='Historial del servidor', exact=True)).to_be_visible()
            page.get_by_role('button', name='Añadir relación', exact=True).click()
            page.locator('#server-relation-type').select_option(value='connected_to')
            page.locator('#server-relation-target').fill('Switch')
            target_select = page.locator('#server-relation-target-select')
            expect(target_select).to_contain_text(ASSET_B)
            target_select.select_option(label=ASSET_B)
            page.locator('#server-relation-reason').fill('Enlace de fase 5')
            page.get_by_role('button', name='Guardar relación', exact=True).click()
            expect(page.locator('#server-relation-target')).to_have_count(0, timeout=20000)
            relations = api(page, '/relationships?assetId=' + asset_a['id'] + '&direction=both&limit=50&offset=0')
            relation = next(item for item in relations['items']
                            if item['typeKey'] == 'connected_to' and item['targetId'] == asset_b['id'])
            assert relation['sourceId'] == asset_a['id'], relation

            # 6b. The host action belongs to the hosted child only: it appears for
            # an authorized `hosted_in` edge and never for another relation type.
            create_asset(page, HOST_C)
            host_c = next(item for item in api(page, '/assets?limit=50&offset=0')['items']
                          if item['name'] == HOST_C)
            hosted = api(page, '/relationships', method='POST', body={
                'typeKey': 'hosted_in',
                'sourceId': asset_b['id'],
                'targetId': asset_a['id'],
                'reason': 'Máquina virtual en el servidor',
            })
            assert hosted['sourceId'] == asset_b['id'] and hosted['targetId'] == asset_a['id'], hosted
            page.goto(BASE + '/#/activo/' + asset_b['id'], wait_until='networkidle')
            expect(page.get_by_role('button', name='Cambiar host', exact=True)).to_be_visible()
            page.goto(BASE + '/#/activo/' + asset_a['id'], wait_until='networkidle')
            expect(page.get_by_role('heading', name='Relaciones', exact=True)).to_be_visible()
            # The hosted edge is incoming for the host, so the panel keeps it
            # read-only there; the locator retries until the canonical panel for
            # this asset has replaced the previous asset's relations.
            expect(page.get_by_role('button', name='Cambiar host', exact=True)).to_have_count(0)

            # 6c. The rendered host-move dialog drives the real contract: the
            # destination comes from the bounded server search, the reason is
            # typed and the operator confirms in the dialog. The persisted effect
            # is asserted through the public API, not by the dialog closing.
            page.goto(BASE + '/#/activo/' + asset_b['id'], wait_until='networkidle')
            page.get_by_role('button', name='Cambiar host', exact=True).click()
            host_dialog = page.get_by_role('dialog')
            expect(host_dialog).to_be_visible()
            expect(host_dialog).to_contain_text('Activo que cambia de host')
            expect(host_dialog).to_contain_text(asset_b['id'])
            # Escape cancels without writing and returns focus to the action.
            page.keyboard.press('Escape')
            expect(page.get_by_role('dialog')).to_have_count(0)
            expect(page.get_by_role('button', name='Cambiar host', exact=True)).to_be_focused()
            page.get_by_role('button', name='Cambiar host', exact=True).click()
            host_dialog = page.get_by_role('dialog')
            expect(host_dialog).to_be_visible()
            host_dialog.locator('#server-host-search').fill('Host alternativo')
            host_option = host_dialog.locator('.assign-option').filter(has_text=HOST_C).first
            expect(host_option).to_be_visible()
            host_option.click()
            host_dialog.locator('#server-host-reason').fill('Cambio de host de fase 5')
            host_dialog.locator('#server-host-notes').fill('Registrado desde el diálogo')
            host_dialog.locator('#server-host-effective').fill('2026-03-01T10:00')
            confirm_host = host_dialog.get_by_role('button', name='Guardar cambio de host', exact=True)
            expect(confirm_host).to_be_enabled()
            confirm_host.click()
            expect(page.get_by_role('dialog')).to_have_count(0, timeout=20000)
            child_relations = api(page, '/relationships?assetId=' + asset_b['id'] + '&direction=both&limit=50&offset=0')
            moved = [item for item in child_relations['items']
                     if item['typeKey'] == 'hosted_in' and item['direction'] != 'incoming']
            assert len(moved) == 1, child_relations
            assert moved[0]['sourceId'] == asset_b['id'], moved[0]
            assert moved[0]['targetId'] == host_c['id'], moved[0]
            assert moved[0]['id'] != hosted['id'], 'the previous hosting edge was replaced'
            assert moved[0]['reason'] == 'Cambio de host de fase 5', moved[0]
            old_host_relations = api(page, '/relationships?assetId=' + asset_a['id'] + '&direction=both&limit=50&offset=0')
            assert not any(item['id'] == hosted['id'] for item in old_host_relations['items']), old_host_relations
            unchanged = api(page, '/assets/' + asset_b['id'])
            assert unchanged['id'] == asset_b['id'], 'the child keeps its canonical UUID'
            moved_history = api(page, '/assets/' + asset_b['id'] + '/history?limit=25&offset=0')
            host_entries = [item for item in moved_history['items'] if item['action'] == 'host_moved']
            assert host_entries, moved_history
            assert str(host_entries[0]['changes']['host']['new']) == host_c['id'], host_entries[0]
            expect(page.get_by_text('Host actualizado.', exact=False).first).to_be_visible()

            # 7. Bounded graph query from the real Vue explorer.
            page.goto(BASE + '/#/infra/grafo', wait_until='networkidle')
            # The notice interpolates the depth, so match the element and then
            # assert its facts instead of an exact whole-string text match.
            graph_notice_locator = page.locator('.server-notice').first
            expect(graph_notice_locator).to_contain_text('Grafo del servidor con profundidad')
            graph_notice = graph_notice_locator.inner_text()
            assert 'nodos' in graph_notice, graph_notice
            page.screenshot(path=str(workdir / 'grafo-1440-light.png'), full_page=True)

            # 8. Canonical relative position persisted and reloaded by the map.
            api(page, '/assets/' + permanent_id, method='PATCH', body={'locationId': floor['id'], 'positionX': '0.25', 'positionY': '0.4'})
            map_payload = api(page, '/map?siteId=' + site['id'])
            # `/map` answers `{sites, positions, limit, offset, truncated}` and each
            # position carries the canonical relative decimals as `x`/`y`.
            placed = next(item for item in map_payload['positions'] if item['assetId'] == permanent_id)
            assert abs(float(placed['x']) - 0.25) < 1e-6, placed
            assert abs(float(placed['y']) - 0.4) < 1e-6, placed
            assert placed['siteId'] == site['id'] and placed['locationId'] == floor['id'], placed
            assert [item['id'] for item in map_payload['sites']] == [site['id']], map_payload['sites']
            page.goto(BASE + '/#/infra/mapa', wait_until='networkidle')
            expect(page.get_by_text('Ubicaciones y posiciones del servidor', exact=False).first).to_be_visible()
            page.reload(wait_until='networkidle')
            reloaded = api(page, '/map?siteId=' + site['id'])
            placed_again = next(item for item in reloaded['positions'] if item['assetId'] == permanent_id)
            assert abs(float(placed_again['x']) - 0.25) < 1e-6, placed_again
            assert abs(float(placed_again['y']) - 0.4) < 1e-6, placed_again

            # 8b. Opening the real floor from the canonical tree renders its
            # placed asset, and an asset located there without coordinates is
            # never drawn at an invented origin.
            open_floor(page)
            expect(page.locator('.floor-marker')).to_have_count(1)
            marker_label = page.locator('.floor-marker').first.get_attribute('aria-label') or ''
            assert ASSET_A in marker_label, marker_label
            unpositioned = api(page, '/assets/' + asset_b['id'], method='PATCH',
                               body={'locationId': floor['id'], 'positionX': None, 'positionY': None})
            assert unpositioned['positionX'] is None and unpositioned['positionY'] is None, unpositioned
            open_floor(page)
            expect(page.locator('.floor-marker')).to_have_count(1)
            marker_label = page.locator('.floor-marker').first.get_attribute('aria-label') or ''
            assert ASSET_B not in marker_label, marker_label
            page.screenshot(path=str(workdir / 'mapa-1440-light.png'), full_page=True)

            # 9. Dark theme and a narrow viewport keep the same real data usable.
            page.locator('.app-shell .theme-toggle').first.click()
            page.goto(BASE + '/#/activo/' + permanent_id, wait_until='networkidle')
            expect(page.get_by_role('heading', name='Historial del servidor', exact=True)).to_be_visible()
            page.screenshot(path=str(workdir / 'activo-1440-dark.png'), full_page=True)
            page.set_viewport_size({'width': 390, 'height': 844})
            page.reload(wait_until='networkidle')
            overflow = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            assert overflow <= 1, 'horizontal overflow at 390px: %s' % overflow
            page.screenshot(path=str(workdir / 'activo-390-dark.png'), full_page=True)

            assert not failures, 'page errors: %s' % failures
            assert not console, 'console errors: %s' % console

            # 10. Denied writing: a role without `assets.edit` never receives the
            # host action and the refused surface persists nothing. The role and
            # user are created through the public identity API of this scratch
            # installation, with a password that only exists in this run.
            before_denial = api(page, '/relationships?assetId=' + asset_b['id'] + '&direction=both&limit=50&offset=0')
            viewer_role = api(page, '/identity/roles', method='POST',
                              body={'name': 'F5 viewer ' + suffix, 'permissions': ['assets.view']})
            api(page, '/identity/users', method='POST', body={
                'username': VIEWER_USERNAME,
                'name': 'F5 Viewer',
                'email': '',
                'roleId': viewer_role['id'],
                'personId': '',
                'active': True,
                'password': VIEWER_PASSWORD,
            })
            page.locator('.user-trigger').click()
            page.get_by_role('menuitem', name='Cerrar sesión').click()
            expect(page.get_by_role('heading', name='Iniciar sesión', exact=True)).to_be_visible()
            page.get_by_label('Usuario', exact=True).fill(VIEWER_USERNAME)
            page.get_by_label('Contraseña', exact=True).fill(VIEWER_PASSWORD)
            page.get_by_role('button', name='Entrar', exact=True).click()
            expect(page.locator('.app-shell')).to_be_visible()
            console.clear()  # the pre-login session probe answers 401 by design
            page.goto(BASE + '/#/activo/' + asset_b['id'], wait_until='networkidle')
            expect(page.get_by_role('heading', name='Relaciones', exact=True)).to_be_visible()
            expect(page.get_by_role('button', name='Cambiar host', exact=True)).to_have_count(0)
            expect(page.get_by_text('Solo lectura', exact=False).first).to_be_visible()
            after_denial = api(page, '/relationships?assetId=' + asset_b['id'] + '&direction=both&limit=50&offset=0')
            assert [(item['id'], item['targetId']) for item in after_denial['items']] == \
                   [(item['id'], item['targetId']) for item in before_denial['items']], \
                'a denied operator changes no hosting relation'
            page.locator('.user-trigger').click()
            page.get_by_role('menuitem', name='Cerrar sesión').click()
            expect(page.get_by_role('heading', name='Iniciar sesión', exact=True)).to_be_visible()

            assert not failures, 'page errors: %s' % failures
            assert not console, 'console errors: %s' % console
            context.close()
            browser.close()

        print('PASS phase 5 server-authority organization: hierarchy, person, assign/return/transfer,')
        print('     structured history, typed relation, rendered host move, denied host write,')
        print('     bounded graph, persisted relative position, dark theme and 390px without overflow')
        print('screenshots:', workdir)
        print(json.dumps({'site': site['id'], 'floor': floor['id'], 'asset': permanent_id}))
    finally:
        stop_owned()
        if os.environ.get('ITSM_PHASE5_KEEP') != '1':
            shutil.rmtree(workdir, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
