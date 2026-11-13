"""Finish-step browser proof. Requires Python Playwright and a setup stack whose
wizard is already green-verified (state ``verifying``), reached by a real claim
and configuration in the same session.

The script proves the last screen before hand-over: the sanitized report is
readable and carries no credential, the JSON download fires, the explicit
confirmation reaches the completed screen with a link to the app, and a reload
after completion never mounts the wizard again.

Environment:
  ASSET_URL               default http://127.0.0.1:5173
  SETUP_CLAIM_CREDENTIAL  one-time credential printed by the setup service
"""
import json
import os
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('ASSET_URL', 'http://127.0.0.1:5173')
CREDENTIAL = os.environ.get('SETUP_CLAIM_CREDENTIAL', '')
STATUS_PATH = '/api/v1/health/ready'
REPORT_PATH = '/api/setup/v1/report'

if not CREDENTIAL:
    raise SystemExit('SETUP_CLAIM_CREDENTIAL is required to prove the finish step')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, locale='es-ES', accept_downloads=True)
    context.add_init_script("try { localStorage.setItem('itsm.locale', 'es'); } catch (e) {}")
    page = context.new_page()
    page.set_default_timeout(8000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    page.goto(BASE, wait_until='networkidle')
    page.locator('#setup-credential').fill(CREDENTIAL)
    page.locator('#setup-credential').press('Enter')
    expect(page.locator('[data-setup-wizard="claimed"]')).to_be_visible(timeout=15000)

    # The verified wizard offers the finish step after a green verification.
    finish = page.locator('[data-setup-finish]')
    expect(finish).to_be_visible(timeout=20000)
    expect(page.get_by_role('heading', name='Instalación lista para finalizar')).to_be_focused()

    # The preview is the service's sanitized report, read before confirming.
    preview = page.locator('[data-setup-finish-report]')
    expect(preview).to_be_visible()
    body = preview.inner_text().lower()
    for forbidden in ('password', 'contraseña', 'secret', 'secreto', 'token', 'api_key', 'database_url'):
        assert forbidden not in body, f'the report preview shows {forbidden}'

    # The download is a JSON file built from that same object.
    with page.expect_download() as download_info:
        page.locator('#setup-finish-download').click()
    download = download_info.value
    assert download.suggested_filename.endswith('.json'), download.suggested_filename
    payload = json.loads(open(download.path(), encoding='utf-8').read())
    assert payload.get('contract') == 'onboarding/v1', payload.get('contract')
    serialized = json.dumps(payload).lower()
    for forbidden in ('password', 'api_key', 'database_url', 'token'):
        assert forbidden not in serialized, f'the report export keeps {forbidden}'

    # The confirmation is explicit and keyboard-reachable.
    confirm = page.locator('#setup-finish-confirm')
    expect(confirm).to_be_enabled()
    confirm.focus()
    page.keyboard.press('Enter')

    completed = page.locator('[data-setup-complete]')
    expect(completed).to_be_visible(timeout=20000)
    expect(page.locator('[data-setup-complete-heading]')).to_be_focused()
    link = page.locator('[data-setup-complete-link]')
    expect(link).to_have_attribute('href', '/')
    expect(page.locator('[data-setup-wizard]')).to_have_count(0)

    # The normal API is the authoritative marker after completion.
    status = context.request.get(BASE + STATUS_PATH, fail_on_status_code=False)
    assert status.json().get('installation_complete') is True, status.text()
    gone = context.request.get(BASE + REPORT_PATH, fail_on_status_code=False)
    assert gone.status in (401, 409), f'a completed report answered {gone.status}'

    # A reload goes to the app, not back into the wizard.
    page.goto(BASE, wait_until='networkidle')
    expect(page.locator('[data-setup-wizard]')).to_have_count(0)
    expect(page.locator('[data-setup-complete]')).to_have_count(0)
    login = page.locator('.login').first
    expect(login).to_be_visible()

    # Mobile keeps the completed screen readable without horizontal overflow.
    page.set_viewport_size({'width': 390, 'height': 900})
    page.goto(BASE, wait_until='networkidle')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')

    assert not errors, errors
    context.close()
    browser.close()
print('PASS setup complete: report preview, JSON download, explicit confirm, completed screen, app hand-over')
