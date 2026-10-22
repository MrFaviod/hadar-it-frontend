"""Fase 5 — grupos de redundancia desde la interfaz real, extremo a extremo.

Arranca su propio uvicorn en loopback sobre una exportación de sólo lectura del
commit aceptado del backend (`c320085`), con SQLite temporal y migrada, un
administrador desechable y el servidor Vite; conduce la interfaz Vue real en
Chromium y comprueba los efectos persistidos por la API pública.

Los dos anfitriones (`hosted_in`) se crean con la API pública de esta misma
instalación desechable, no con la interfaz: la relación de alojamiento no forma
parte de este trabajo. Los grupos, en cambio, se crean y editan desde la UI.

Sólo detiene los procesos que creó. Sin archivo .env, sin Docker y sin tocar
bases de datos existentes. Requiere playwright + Chromium en el equipo.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import uuid
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
CANONICAL_BACKEND = Path(os.environ.get('ITSM_PHASE5_BACKEND') or ROOT.parent / 'backend')
PINNED_BACKEND_COMMIT = 'c320085'
PYTHON = CANONICAL_BACKEND / '.venv' / 'bin' / 'python'


def pinned_backend():
    """Exportación de sólo lectura del commit aceptado del backend.

    `git archive` sólo lee el repositorio canónico y escribe en el directorio
    ignorado `.verification/`; el checkout, su índice y sus ramas quedan intactos.
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
SUFFIX = uuid.uuid4().hex[:6]
USERNAME = 'phase5.redundancy.admin'
PASSWORD = 'Phase5-Redundancy-Pass-9k'
VIEWER_USERNAME = 'phase5.redundancy.viewer.' + SUFFIX
VIEWER_PASSWORD = 'Phase5-Redundancy-Viewer-4m'

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
    # Primero se limpia todo ITSM_* heredado para que un shell externo no pueda
    # apuntar esta corrida a otra base, origen ni almacenamiento.
    env = {key: value for key, value in os.environ.items() if not key.startswith('ITSM_')}
    env.update({
        'ITSM_DATABASE_URL': 'sqlite+pysqlite:///' + str(database),
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
    """Petición en la sesión del navegador; devuelve el cuerpo ya deserializado."""
    result = page.evaluate(API_JS, {'path': path, 'method': method, 'body': body})
    assert result['status'] < 400, '%s %s -> %s %s' % (method, path, result['status'], result['body'])
    return result['body']


def login(page, username, password):
    page.goto(BASE + '/#/login', wait_until='networkidle')
    page.get_by_label('Usuario', exact=True).fill(username)
    page.get_by_label('Contraseña', exact=True).fill(password)
    page.get_by_role('button', name='Entrar', exact=True).click()
    expect(page.locator('.app-shell')).to_be_visible()


def create_asset(page, name):
    """Crea un activo con el editor Vue existente y comprueba que persistió."""
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
    match = next((item for item in payload['items'] if item['name'] == name), None)
    assert match is not None, 'asset %r was not persisted' % name
    return match['id']


def host_asset(page, member_id, host_id, reason):
    """Alojamiento por la API pública: fuera del alcance de este trabajo."""
    api(page, '/relationships', method='POST',
        body={'typeKey': 'hosted_in', 'sourceId': member_id, 'targetId': host_id, 'reason': reason})
    links = api(page, '/relationships?assetId=' + member_id + '&typeKey=hosted_in&direction=out&limit=50&offset=0')
    targets = [item['targetId'] for item in links['items']]
    assert targets == [host_id], targets


def open_detail(page, asset_id):
    page.goto(BASE + '/#/activo/' + asset_id, wait_until='networkidle')
    expect(page.get_by_role('heading', name='Redundancia', exact=True)).to_be_visible()


def group_items(page):
    return page.locator('.redundancy-item')


def open_new_group(page):
    page.get_by_role('button', name='Nuevo grupo', exact=True).click()
    dialog = page.get_by_role('dialog')
    expect(dialog).to_be_visible()
    return dialog


def add_member(page, asset_id):
    page.locator('[data-redundancy-add="%s"]' % asset_id).click()
    expect(page.locator('[data-redundancy-remove="%s"]' % asset_id)).to_be_visible()


def set_share(page, asset_id, value):
    field = page.locator('[data-redundancy-share="%s"]' % asset_id)
    try:
        field.wait_for(state='visible', timeout=10000)
    except Exception:
        dialog = page.get_by_role('dialog')
        detail = dialog.inner_text()[:700] if dialog.count() else 'no dialog'
        raise AssertionError('no share field for %s: %s' % (asset_id, detail))
    field.fill(value)
    assert field.input_value() == value, field.input_value()


def save_group(page):
    page.get_by_role('dialog').get_by_role('button', name='Guardar grupo', exact=True).click()
    try:
        expect(page.get_by_role('dialog')).to_have_count(0, timeout=20000)
    except AssertionError:
        raise AssertionError('group dialog kept open: ' + page.get_by_role('dialog').inner_text()[:600])


def groups_payload(page):
    return api(page, '/redundancy-groups?limit=200&offset=0')


def group_named(payload, name):
    match = next((item for item in payload['items'] if item['name'] == name), None)
    assert match is not None, 'group %r was not persisted: %s' % (name, [item['name'] for item in payload['items']])
    return match


def member_map(group):
    return {member['assetId']: member for member in group['members']}


def main():
    workdir = ROOT / '.verification' / ('phase5-redundancy-' + SUFFIX)
    if workdir.exists():
        shutil.rmtree(workdir)
    workdir.mkdir(parents=True)
    database = workdir / 'phase5-redundancy.db'
    task_database = workdir / 'phase5-redundancy-tasks.db'
    env = run_env(database, task_database)
    name_a = 'VM A ' + SUFFIX
    name_b = 'VM B ' + SUFFIX
    host_north = 'Host Norte ' + SUFFIX
    host_south = 'Host Sur ' + SUFFIX
    group_name = 'Réplicas ' + SUFFIX
    passive_name = 'Par principal-respaldo ' + SUFFIX
    try:
        subprocess.run([str(PYTHON), '-m', 'alembic', 'upgrade', 'head'], cwd=BACKEND, env=env, check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        subprocess.run([str(PYTHON), '-m', 'itsm.identity.cli', 'bootstrap-admin', '--username', USERNAME,
                        '--name', 'Fase 5 Redundancia'], cwd=BACKEND, env=env, check=True,
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

            login(page, USERNAME, PASSWORD)
            console.clear()  # la sonda de sesión previa al login responde 401 por diseño

            asset_a = create_asset(page, name_a)
            asset_b = create_asset(page, name_b)
            host_1 = create_asset(page, host_north)
            host_2 = create_asset(page, host_south)
            host_asset(page, asset_a, host_1, 'Alojamiento de la prueba de redundancia')
            host_asset(page, asset_b, host_2, 'Alojamiento de la prueba de redundancia')
            assert asset_a != asset_b and host_1 != host_2

            # 1. Grupo activo/activo con reparto 40:60 creado desde la UI.
            open_detail(page, asset_a)
            dialog = open_new_group(page)
            dialog.locator('#redundancy-name').fill(group_name)
            dialog.locator('#redundancy-description').fill('Dos réplicas en hosts distintos')
            # El alta desde la ficha siembra el activo que se está viendo.
            expect(page.locator('[data-redundancy-remove="%s"]' % asset_a)).to_be_visible()
            add_member(page, asset_b)
            set_share(page, asset_a, '40')
            set_share(page, asset_b, '60')
            save_group(page)

            created = group_named(groups_payload(page), group_name)
            members = member_map(created)
            assert created['mode'] == 'active_active' and created['active'] is True, created
            assert created['description'] == 'Dos réplicas en hosts distintos', created
            assert members[asset_a]['share'] == '40' and members[asset_b]['share'] == '60', members
            assert members[asset_a]['role'] is None and members[asset_b]['role'] is None, members
            assert members[asset_a]['host']['name'] == host_north, members[asset_a]
            assert members[asset_b]['host']['name'] == host_south, members[asset_b]
            assert created['memberCount'] == 2, created

            # 2. Recarga real desde el servidor: el reparto llega a la UI.
            open_detail(page, asset_a)
            item = group_items(page).filter(has_text=group_name).first
            expect(item).to_be_visible()
            expect(item.get_by_text('Reparto de carga 40 %', exact=False).first).to_be_visible()
            expect(item.get_by_text('Reparto de carga 60 %', exact=False).first).to_be_visible()
            expect(item.get_by_text('Activo/activo', exact=False).first).to_be_visible()
            expect(page.locator('.redundancy-item').filter(has_text=group_name).first
                   .get_by_text(host_north, exact=False).first).to_be_visible()
            page.screenshot(path=str(workdir / 'redundancia-1440-light.png'), full_page=True)

            # 3. Editar el reparto desde la UI y persistir la lista completa.
            item.get_by_role('button', name='Editar', exact=True).click()
            dialog = page.get_by_role('dialog')
            expect(dialog).to_be_visible()
            assert dialog.locator('#redundancy-name').input_value() == group_name
            set_share(page, asset_a, '45')
            set_share(page, asset_b, '55')
            save_group(page)
            edited = group_named(groups_payload(page), group_name)
            shares = {key: member['share'] for key, member in member_map(edited).items()}
            assert shares == {asset_a: '45', asset_b: '55'}, shares

            # 4. Grupo activo/pasivo desde la UI: principal y respaldo, sin reparto.
            open_detail(page, asset_a)
            dialog = open_new_group(page)
            dialog.locator('#redundancy-name').fill(passive_name)
            dialog.locator('#redundancy-mode').select_option('active_passive')
            add_member(page, asset_b)
            expect(page.locator('[data-redundancy-share="%s"]' % asset_a)).to_have_count(0)
            assert page.locator('[data-redundancy-role="%s"]' % asset_a).input_value() == 'primary'
            assert page.locator('[data-redundancy-role="%s"]' % asset_b).input_value() == 'backup'
            save_group(page)
            passive = group_named(groups_payload(page), passive_name)
            passive_members = member_map(passive)
            assert passive['mode'] == 'active_passive', passive
            assert passive_members[asset_a]['role'] == 'primary', passive_members
            assert passive_members[asset_b]['role'] == 'backup', passive_members
            assert passive_members[asset_a]['share'] is None and passive_members[asset_b]['share'] is None, passive_members
            passive_item = page.locator('.redundancy-item').filter(has_text=passive_name).first
            expect(passive_item.get_by_text('Principal', exact=False).first).to_be_visible()
            expect(passive_item.get_by_text('Respaldo', exact=False).first).to_be_visible()
            page.screenshot(path=str(workdir / 'redundancia-pasivo-1440-light.png'), full_page=True)

            # 5. Desactivar y reactivar por la UI, con los controles del servidor.
            passive_item.get_by_role('button', name='Desactivar', exact=True).click()
            expect(passive_item.get_by_text('Inactivo', exact=False).first).to_be_visible(timeout=15000)
            assert group_named(groups_payload(page), passive_name)['active'] is False
            passive_item.get_by_role('button', name='Reactivar', exact=True).click()
            expect(passive_item.get_by_text('Activo', exact=False).first).to_be_visible(timeout=15000)
            assert group_named(groups_payload(page), passive_name)['active'] is True

            # 6. Un 409 real del servidor se muestra en la UI: se archiva un
            # miembro de un grupo inactivo y la reactivación se rechaza.
            third_name = 'VM C ' + SUFFIX
            asset_c = create_asset(page, third_name)
            open_detail(page, asset_a)
            dialog = open_new_group(page)
            dialog.locator('#redundancy-name').fill('Temporal ' + SUFFIX)
            add_member(page, asset_c)
            set_share(page, asset_a, '50')
            set_share(page, asset_c, '50')
            save_group(page)
            temporary_item = page.locator('.redundancy-item').filter(has_text='Temporal ' + SUFFIX).first
            temporary_item.get_by_role('button', name='Desactivar', exact=True).click()
            expect(temporary_item.get_by_text('Inactivo', exact=False).first).to_be_visible(timeout=15000)
            api(page, '/assets/' + asset_c + '/archive', method='POST', body={})
            temporary_item = page.locator('.redundancy-item').filter(has_text='Temporal ' + SUFFIX).first
            temporary_item.get_by_role('button', name='Reactivar', exact=True).click()
            # La clase del aviso distingue el rechazo del aviso correcto anterior.
            toast = page.locator('.toast.toast--error')
            expect(toast).to_be_visible(timeout=15000)
            assert (toast.inner_text() or '').strip(), 'the refusal toast carried no message'
            assert group_named(groups_payload(page), 'Temporal ' + SUFFIX)['active'] is False, \
                'a refused reactivation must not be reported as committed'
            # 6b. Un grupo inactivo puede quedar sin réplicas desde la UI; el
            # servidor conserva nombre, modo y estado inactivo.
            temporary_item = page.locator('.redundancy-item').filter(has_text='Temporal ' + SUFFIX).first
            temporary_item.get_by_role('button', name='Editar', exact=True).click()
            dialog = page.get_by_role('dialog')
            expect(dialog).to_be_visible(timeout=15000)
            for member_id in (asset_a, asset_c):
                remove = dialog.locator('[data-redundancy-remove="%s"]' % member_id)
                if remove.count():
                    remove.click()
            expect(dialog.locator('[data-redundancy-remove]')).to_have_count(0, timeout=15000)
            dialog.get_by_role('button', name='Guardar grupo').click()
            expect(page.get_by_role('dialog')).to_have_count(0, timeout=15000)
            cleaned = group_named(groups_payload(page), 'Temporal ' + SUFFIX)
            assert cleaned['members'] == [], cleaned['members']
            assert cleaned['active'] is False, cleaned['active']
            assert cleaned['mode'] == 'active_active', cleaned['mode']
            # El grupo limpiado ya no incluye este activo, así que la ficha deja de
            # listarlo; los grupos que sí lo incluyen siguen visibles.
            expect(page.locator('.redundancy-item').filter(has_text='Temporal ' + SUFFIX)).to_have_count(
                0, timeout=15000)
            expect(page.locator('.redundancy-item').filter(has_text=group_name).first).to_be_visible(
                timeout=15000)

            # El aviso se retira solo; la captura del grafo no debe taparse con él.
            expect(page.locator('.toast')).to_have_count(0, timeout=20000)

            # 7. El grafo muestra los grupos sin convertirlos en vínculos de alojamiento.
            page.goto(BASE + '/#/infra/grafo', wait_until='networkidle')
            expect(page.locator('.gnode').first).to_be_visible(timeout=20000)
            expect(page.locator('.gnode__redundancy')).to_have_count(2, timeout=20000)
            graph_panel = page.locator('.graph-redundancy')
            expect(graph_panel).to_be_visible()
            expect(graph_panel.get_by_text(group_name, exact=False).first).to_be_visible()
            expect(graph_panel.get_by_text(passive_name, exact=False).first).to_be_visible()
            directed = page.evaluate("""() => Array.from(document.querySelectorAll('line.gedge'))
                .filter((line) => (line.getAttribute('marker-end') || '').startsWith('url(#garrow-')).length""")
            assert directed >= 2, directed
            page.screenshot(path=str(workdir / 'redundancia-grafo-1440-light.png'), full_page=True)

            # 8. Foco de teclado visible en un control del grupo.
            open_detail(page, asset_a)
            focused = None
            for _ in range(400):
                page.keyboard.press('Tab')
                state = page.evaluate("""() => {
                  const element = document.activeElement;
                  if (!element || !element.classList || !element.classList.contains('quick-action')) return null;
                  if ((element.textContent || '').trim() !== 'Editar') return null;
                  const style = window.getComputedStyle(element);
                  return {
                    style: style.outlineStyle,
                    width: style.outlineWidth,
                    visible: element.matches(':focus-visible'),
                  };
                }""")
                if state:
                    focused = state
                    break
            assert focused, 'keyboard focus never reached the group edit control'
            assert focused['visible'] and focused['style'] != 'none' and focused['width'] not in ('', '0px'), focused

            # 9. Tema oscuro y 390px sin desbordes.
            page.locator('.app-shell .theme-toggle').first.click()
            page.reload(wait_until='networkidle')
            expect(page.get_by_role('heading', name='Redundancia', exact=True)).to_be_visible()
            page.screenshot(path=str(workdir / 'redundancia-1440-dark.png'), full_page=True)
            page.set_viewport_size({'width': 390, 'height': 844})
            page.reload(wait_until='networkidle')
            expect(page.get_by_role('heading', name='Redundancia', exact=True)).to_be_visible()
            overflow = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            assert overflow <= 1, 'horizontal overflow at 390px: %s' % overflow
            page.screenshot(path=str(workdir / 'redundancia-390-dark.png'), full_page=True)
            page.set_viewport_size({'width': 1440, 'height': 1000})

            # 10. Lectura sin escritura: rol con `assets.view` y nada más.
            before_denial = groups_payload(page)
            viewer_role = api(page, '/identity/roles', method='POST',
                              body={'name': 'F5 redundancia viewer ' + SUFFIX, 'permissions': ['assets.view']})
            api(page, '/identity/users', method='POST', body={
                'username': VIEWER_USERNAME,
                'name': 'F5 Redundancia Viewer',
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
            console.clear()  # la sonda previa al login responde 401 por diseño
            open_detail(page, asset_a)
            expect(page.get_by_role('button', name='Nuevo grupo', exact=True)).to_have_count(0)
            expect(page.get_by_text('Solo lectura', exact=False).first).to_be_visible()
            expect(page.get_by_text('no reparte tráfico', exact=False).first).to_be_visible()
            after_denial = groups_payload(page)
            assert [(item['id'], item['active'], len(item['members'])) for item in after_denial['items']] == \
                   [(item['id'], item['active'], len(item['members'])) for item in before_denial['items']], \
                'a denied operator changes no redundancy group'

            assert not failures, 'page errors: %s' % failures
            assert not console, 'console errors: %s' % console
            context.close()
            browser.close()

        print('PASS fase 5 grupos de redundancia: 40:60 creado desde la UI, reparto editado,')
        print('     modo activo/pasivo, desactivar/reactivar, 409 de reactivación visible,')
        print('     grafo con grupos y alojamiento dirigido separado, tema oscuro y 390px,')
        print('     lectura sin escritura con `assets.view`')
        print('screenshots:', workdir)
        print(json.dumps({'assetA': asset_a, 'assetB': asset_b, 'group': group_name}))
    finally:
        stop_owned()


if __name__ == '__main__':
    sys.exit(main())
