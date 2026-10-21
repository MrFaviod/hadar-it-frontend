"""Exercise real React StrictMode cleanup and Vue remounting through public UI."""
import os
from playwright.sync_api import sync_playwright, expect

base = os.environ.get('ASSET_URL', 'http://127.0.0.1:5173')
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(base + '/tests/host-lifecycle.html', wait_until='networkidle')
    expect(page.get_by_label('Usuario', exact=True)).to_be_visible()
    page.get_by_label('Usuario', exact=True).fill('admin')
    page.get_by_label('Contraseña', exact=True).fill('admin')
    page.get_by_role('button', name='Entrar', exact=True).click()
    expect(page.locator('.app-shell')).to_be_visible()
    page.locator('#unmount').click()
    expect(page.locator('#root')).to_be_empty()
    page.locator('#remount').click()
    expect(page.locator('.app-shell')).to_have_count(1)
    page.evaluate("location.hash = '#/reportes'")
    expect(page.get_by_role('heading', level=1)).to_be_visible()
    assert not errors, errors
    browser.close()
print('PASS StrictMode, cleanup, authenticated remount and hash navigation')
