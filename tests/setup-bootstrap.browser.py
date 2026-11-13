"""First-start wizard browser proof. Requires Python Playwright and a running
frontend whose /api/setup/v1 answers with setup enabled (unclaimed).

The stack is expected to be the setup service alone: no database, no API. The
script proves the wizard is reachable without them, that an anonymous session
is denied, that a wrong credential is reported, that the real one reaches the
claimed step, and that the session survives a reload.

Environment:
  ASSET_URL               default http://127.0.0.1:5173
  SETUP_CLAIM_CREDENTIAL  one-time credential printed by the setup service
"""
import os
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('ASSET_URL', 'http://127.0.0.1:5173')
CREDENTIAL = os.environ.get('SETUP_CLAIM_CREDENTIAL', '')
WRONG = 'not-the-one-time-credential'
SESSION_PATH = '/api/setup/v1/session'

if not CREDENTIAL:
    raise SystemExit('SETUP_CLAIM_CREDENTIAL is required to prove the claim step')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, locale='es-ES')
    # The wizard reads the shared catalog preference, not a private locale.
    context.add_init_script("try { localStorage.setItem('itsm.locale', 'es'); } catch (e) {}")
    page = context.new_page()
    page.set_default_timeout(5000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    # A stack with no claim must not start the legacy shell.
    page.goto(BASE, wait_until='networkidle')
    wizard = page.locator('[data-setup-wizard="claim"]')
    expect(wizard).to_be_visible()
    expect(page.locator('#root [data-react-host]')).to_have_count(0)
    expect(page.locator('.app-shell')).to_have_count(0)
    expect(page.get_by_role('heading', name='Configuración inicial', level=1)).to_be_visible()

    # AutoFocus lands on the credential field: the flow is usable from the keyboard.
    credential = page.locator('#setup-credential')
    expect(credential).to_be_focused()
    assert credential.get_attribute('type') == 'password', 'the credential must not be readable on screen'

    # Anonymous callers get no session, only a denial.
    anonymous = context.request.get(BASE + SESSION_PATH, fail_on_status_code=False)
    assert anonymous.status in (401, 403), f'anonymous session answered {anonymous.status}'

    # A rejected credential is reported in the live region and focus moves to
    # the alert, which is a focusable role="alert" summary; the field is the
    # next stop in the tab order, so the retry stays keyboard-only.
    page.keyboard.type(WRONG)
    page.keyboard.press('Enter')
    alert = page.locator('#setup-message')
    expect(alert).to_be_visible()
    expect(alert).to_have_attribute('class', 'form-alert')
    expect(alert).to_have_attribute('role', 'alert')
    expect(wizard).to_be_visible()
    expect(page.locator('[data-setup-wizard="claimed"]')).to_have_count(0)
    expect(alert).to_be_focused()

    # Keyboard only: Tab back to the field, replace the credential, submit with Enter.
    page.keyboard.press('Tab')
    expect(credential).to_be_focused()
    page.keyboard.press('Control+a')
    page.keyboard.type(CREDENTIAL)
    page.keyboard.press('Enter')

    claimed = page.locator('[data-setup-wizard="claimed"]')
    expect(claimed).to_be_visible(timeout=10000)
    expect(page.get_by_role('heading', name='Instalación reclamada', level=1)).to_be_focused()
    expect(page.locator('[data-setup-state]')).to_have_text('claimed')
    pending = page.locator('[data-setup-step="pending"]')
    expect(pending).to_have_count(5)
    for index in range(pending.count()):
        expect(pending.nth(index)).to_contain_text('Pendiente')

    # The session cookie is HttpOnly and path-scoped: the browser never reads it.
    cookies = {cookie['name']: cookie for cookie in context.cookies()}
    assert 'itsm_setup_session' in cookies, cookies.keys()
    assert cookies['itsm_setup_session']['httpOnly'] is True
    assert cookies['itsm_setup_session']['path'] == '/api/setup/v1'
    assert page.evaluate("localStorage.getItem('itsm_setup_session')") is None

    authenticated = context.request.get(BASE + SESSION_PATH, fail_on_status_code=False)
    assert authenticated.status == 200, f'session after claim answered {authenticated.status}'
    assert authenticated.json().get('state') == 'claimed'

    # A reload keeps the wizard on the claimed step instead of falling back to login.
    page.reload(wait_until='networkidle')
    expect(page.locator('[data-setup-wizard="claimed"]')).to_be_visible()
    expect(page.locator('.app-shell')).to_have_count(0)

    # Mobile: the wizard holds its single column without horizontal overflow.
    page.set_viewport_size({'width': 390, 'height': 900})
    page.reload(wait_until='networkidle')
    expect(page.locator('[data-setup-wizard="claimed"]')).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')

    assert not errors, errors
    context.close()
    browser.close()
print('PASS setup wizard: claim step, anonymous denial, wrong credential, claimed step, reload, keyboard-only')
