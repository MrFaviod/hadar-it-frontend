"""Real F2 browser/API contracts. Use an isolated, bootstrapped test database.

Required: ITSM_TEST_USERNAME / ITSM_TEST_PASSWORD. Creates uniquely named users
and roles, never deletes data or touches an existing account other than its own session.
"""
import os
import uuid
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('ASSET_URL', 'http://127.0.0.1:5173')
USERNAME = os.environ['ITSM_TEST_USERNAME']
PASSWORD = os.environ['ITSM_TEST_PASSWORD']
suffix = uuid.uuid4().hex[:10]
reader = 'reader-' + suffix
role_name = 'Lectura ' + suffix


def login(page, username, password):
    page.goto(BASE + '/#/login', wait_until='networkidle')
    page.get_by_label('Usuario', exact=True).fill(username)
    page.get_by_label('Contraseña', exact=True).fill(password)
    page.get_by_role('button', name='Entrar', exact=True).click()
    expect(page.locator('.app-shell')).to_be_visible()


def api(page, path, method='GET', body=None, csrf=True):
    return page.evaluate('''async ({path, method, body, csrf}) => {
      const me = await fetch('/api/v1/auth/me').then(r => r.json());
      const headers = {'Content-Type': 'application/json'};
      if (csrf) headers['X-CSRF-Token'] = me.csrfToken;
      const response = await fetch('/api/v1' + path, {method, headers,
        body: body === null ? undefined : JSON.stringify(body)});
      return {status: response.status, body: await response.json()};
    }''', dict(path=path, method=method, body=body, csrf=csrf))


with sync_playwright() as p:
    browser = p.chromium.launch()
    admin_context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    page = admin_context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    login(page, USERNAME, PASSWORD)
    assert page.evaluate("sessionStorage.getItem('asset-manager.session')") is None
    assert page.evaluate("localStorage.getItem('asset-manager.access')") is None
    cookie = next(item for item in admin_context.cookies() if item['name'] == 'itsm_session')
    assert cookie['httpOnly'] and cookie['sameSite'] == 'Strict'
    assert 'itsm_session=' not in page.evaluate('document.cookie')
    page.reload(wait_until='networkidle')
    expect(page.locator('.app-shell')).to_be_visible()

    page.goto(BASE + '/#/configuracion/seguridad', wait_until='networkidle')
    expect(page.get_by_role('heading', name='Usuarios y permisos', exact=True)).to_be_visible()
    page.get_by_role('button', name='Nuevo rol', exact=True).click()
    page.locator('#access-role-name').fill(role_name)
    editor = page.get_by_role('dialog')
    editor.locator('.permission-module').filter(has_text='Activos').get_by_text('Ver', exact=True).click()
    page.get_by_role('button', name='Guardar rol', exact=True).click()
    expect(page.get_by_role('dialog')).to_have_count(0)
    expect(page.locator('.role-row').filter(has_text=role_name)).to_be_visible()
    state = api(page, '/identity/state')
    role = next(item for item in state['body']['roles'] if item['name'] == role_name)
    assert role['permissions'] == ['assets.view']
    assert page.get_by_role('button', name='Editar rol Administrador', exact=True).count() == 0

    page.goto(BASE + '/#/usuarios', wait_until='networkidle')
    page.get_by_role('button', name='Nuevo usuario', exact=True).click()
    page.locator('#access-username').fill(reader)
    page.locator('#access-name').fill('Lector ' + suffix)
    page.locator('#access-role').select_option(role['id'])
    page.locator('#access-password').fill(PASSWORD)
    page.get_by_role('button', name='Guardar usuario', exact=True).click()
    expect(page.get_by_role('dialog')).to_have_count(0)
    row = page.locator('tr').filter(has_text=reader)
    expect(row).to_be_visible()
    page.reload(wait_until='networkidle')
    expect(page.locator('tr').filter(has_text=reader)).to_be_visible()
    state = api(page, '/identity/state')['body']
    user = next(item for item in state['users'] if item['username'] == reader)
    assert user['actorKind'] == 'human' and user['personId'] in ('', None)
    assert 'password' not in user
    rejected = api(page, '/identity/settings', 'PUT', {'sessionMinutes': 15}, csrf=False)
    assert rejected['status'] == 403, rejected

    reader_context = browser.new_context(viewport={'width': 390, 'height': 844})
    reader_page = reader_context.new_page()
    login(reader_page, reader, PASSWORD)
    assert reader_page.get_by_role('button', name='Nuevo activo', exact=True).count() == 0
    reader_page.goto(BASE + '/#/usuarios', wait_until='networkidle')
    expect(reader_page.get_by_role('heading', name='Acceso denegado', exact=True)).to_be_visible()
    denied = api(reader_page, '/identity/roles', 'POST', {'name': 'Denied ' + suffix, 'permissions': ['users.edit']})
    assert denied['status'] == 403, denied
    assert api(page, '/identity/state')['body']['roles'] == state['roles']

    deactivated = api(page, '/identity/users/' + user['id'] + '/active', 'PATCH', {'active': False})
    assert deactivated['status'] == 200, deactivated
    reader_page.reload(wait_until='networkidle')
    expect(reader_page.get_by_role('heading', name='Iniciar sesión', exact=True)).to_be_visible()
    assert api(reader_page, '/auth/me')['status'] == 401
    assert not errors, errors
    reader_context.close()
    page.locator('.user-trigger').click()
    page.get_by_role('menuitem', name='Cerrar sesión').click()
    expect(page.get_by_role('heading', name='Iniciar sesión', exact=True)).to_be_visible()
    page.reload(wait_until='networkidle')
    expect(page.get_by_role('heading', name='Iniciar sesión', exact=True)).to_be_visible()
    assert not any(item['name'] == 'itsm_session' for item in admin_context.cookies())
    admin_context.close()
    browser.close()
print('PASS real login/remount/logout, SQL-backed roles/users, reader deny, CSRF reject and deactivation')
