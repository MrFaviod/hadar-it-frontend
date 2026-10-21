"""Public UI permission ceilings; requires an isolated installed administrator."""
import os
import uuid
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('ASSET_URL', 'http://127.0.0.1:5173')
USERNAME = os.environ['ITSM_TEST_USERNAME']
PASSWORD = os.environ['ITSM_TEST_PASSWORD']
suffix = uuid.uuid4().hex[:10]


def login(page, username):
    page.goto(BASE + '/#/login', wait_until='networkidle')
    page.get_by_label('Usuario', exact=True).fill(username)
    page.get_by_label('Contraseña', exact=True).fill(PASSWORD)
    page.get_by_role('button', name='Entrar', exact=True).click()
    expect(page.locator('.app-shell')).to_be_visible()


def create(page, path, body):
    result = page.evaluate('''async ({path,body})=>{
      const me=await fetch('/api/v1/auth/me').then(r=>r.json());
      const r=await fetch('/api/v1'+path,{method:'POST',headers:{
        'Content-Type':'application/json','X-CSRF-Token':me.csrfToken},body:JSON.stringify(body)});
      return {status:r.status,body:await r.json()};
    }''', dict(path=path, body=body))
    assert result['status'] == 201, result
    return result['body']


with sync_playwright() as p:
    browser = p.chromium.launch()
    admin = browser.new_context()
    page = admin.new_page()
    login(page, USERNAME)
    role = create(page, '/identity/roles', {
        'name': 'Limited manager ' + suffix,
        'permissions': ['assets.view', 'users.view', 'users.create', 'users.edit', 'roles.manage']})
    # API mutation responses wrap their DTO in a named field.
    role = role.get('role', role)
    actor = 'limited-' + suffix
    create(page, '/identity/users', {'username': actor, 'name': actor, 'roleId': role['id'],
                                     'password': PASSWORD})
    context = browser.new_context()
    limited = context.new_page()
    login(limited, actor)
    limited.goto(BASE + '/#/usuarios', wait_until='networkidle')
    # Higher-privilege targets must not advertise edit/reset/deactivation actions.
    row = limited.locator('tr').filter(has_text=USERNAME)
    expect(row).to_be_visible()
    expect(row.get_by_role('button', name='Editar', exact=True)).to_have_count(0)
    expect(row.get_by_role('button', name='Desactivar', exact=True)).to_have_count(0)
    limited.get_by_role('button', name='Nuevo usuario', exact=True).click()
    assert limited.locator('#access-role option[value="admin"]').count() == 0
    assert limited.locator('#access-role option[value="operator"]').count() == 0
    expect(limited.locator('#access-role option').filter(has_text=role['name'])).to_have_count(1)
    limited.get_by_role('button', name='Cancelar', exact=True).click()
    limited.goto(BASE + '/#/configuracion/seguridad', wait_until='networkidle')
    limited.get_by_role('button', name='Nuevo rol', exact=True).click()
    dialog = limited.get_by_role('dialog')
    # A role manager without sessions.manage cannot grant that permission.
    session_permission = dialog.locator('.permission-module').filter(has_text='Sesiones')
    expect(session_permission.locator('input[type="checkbox"]')).to_be_disabled()
    assert not limited.evaluate('document.documentElement.scrollWidth>innerWidth')
    context.close()
    admin.close()
    browser.close()
print('PASS administrative UI respects actor ceilings for users, role assignment and policy grants')
