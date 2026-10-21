"""Public browser smoke test. Requires Python Playwright and a running frontend."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

USERNAME = os.environ['ITSM_TEST_USERNAME']
PASSWORD = os.environ['ITSM_TEST_PASSWORD']

base = os.environ.get('ASSET_URL', 'http://127.0.0.1:5173')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for width in (1440, 390):
        context = browser.new_context(viewport={'width': width, 'height': 1000})
        page = context.new_page()
        page.set_default_timeout(5000)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(base, wait_until='networkidle')
        expect(page.locator('#root [data-react-host]')).to_have_count(1)
        expect(page.get_by_label('Usuario', exact=True)).to_be_visible()
        page.get_by_label('Usuario', exact=True).fill(USERNAME)
        page.get_by_label('Contraseña', exact=True).fill(PASSWORD)
        page.get_by_role('button', name='Entrar', exact=True).click()
        expect(page.locator('.app-shell')).to_be_visible()
        for route in ('#/panel', '#/inventario', '#/reportes', '#/garantias', '#/etiquetas', '#/configuracion/apariencia'):
            page.goto(base + '/' + route, wait_until='networkidle')
            expect(page.locator('h1').first).to_be_visible()
            assert page.evaluate('location.hash') == route, route
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), route
        assert not errors, errors
        Path('.verification').mkdir(exist_ok=True)
        page.screenshot(path=f'.verification/react-{width}.png', full_page=True)
        context.close()
    browser.close()
print('PASS React host, server login, six routes, desktop/mobile and page errors')
