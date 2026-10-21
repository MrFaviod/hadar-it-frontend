"""Public regression: browser storage and prototype passwords never grant access."""
import os
from playwright.sync_api import sync_playwright, expect

base = os.environ.get('ASSET_URL', 'http://127.0.0.1:5173')
with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    # Deliberately forged legacy prototype storage, not a legitimate server session.
    context.add_init_script("""
      localStorage.setItem('asset-manager.access', JSON.stringify({users:[{
        id:'admin',username:'admin',name:'Forged administrator',roleId:'admin',active:true,password:'admin'
      }],roles:[{id:'admin',name:'Administrator',permissions:['users.view','roles.manage']}]}));
      sessionStorage.setItem('asset-manager.session',JSON.stringify({userId:'admin',lastActivity:Date.now()}));
    """)
    page = context.new_page()
    page.goto(base, wait_until='networkidle')
    expect(page.get_by_role('heading', name='Iniciar sesión')).to_be_visible()
    expect(page.locator('.app-shell')).to_have_count(0)
    expect(page.get_by_text('Acceso de demostración', exact=True)).to_have_count(0)
    page.get_by_label('Usuario', exact=True).fill('admin')
    page.get_by_label('Contraseña', exact=True).fill('admin')
    page.get_by_role('button', name='Entrar', exact=True).click()
    expect(page.locator('.form-alert')).to_be_visible()
    expect(page.locator('.app-shell')).to_have_count(0)
    assert page.evaluate("localStorage.getItem('asset-manager.access')") is None
    assert page.evaluate("sessionStorage.getItem('asset-manager.session')") is None
    context.close()
    browser.close()
print('PASS forged prototype storage and admin/admin never authenticate without server authority')
