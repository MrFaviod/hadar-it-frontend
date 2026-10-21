"""Login refinement acceptance checks against the running frontend.

Covers the audited login contract: required-field and failure focus, session
rejection, demo disclosure, touch targets, keyboard access, responsive layout
and the shared primary-button hover contrast in the dark theme.

Run with the dev server up: python3 tests/login-audit.browser.py
Set ASSET_URL to point at another base URL.
"""
import os
import re
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get('ASSET_URL', 'http://127.0.0.1:5173')
SESSION_KEY = 'asset-manager.session'
SHOTS = Path('.verification/audit-after')
CHECKS = []
PAGE_ERRORS = []
CONSOLE_ERRORS = []


def check(fn):
    CHECKS.append(fn)
    return fn


# --- colour helpers -------------------------------------------------------


def rgb(value):
    match = re.match(r'rgba?\(([^)]+)\)', value)
    assert match, value
    parts = [float(part) for part in re.split(r'[,\s/]+', match.group(1).strip()) if part]
    return parts[:3]


def luminance(color):
    channels = []
    for channel in rgb(color):
        channel /= 255
        channels.append(channel / 12.92 if channel <= 0.03928 else ((channel + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def hex_rgb(value):
    match = re.fullmatch(r'#([0-9a-f]{6})', value.strip(), re.I)
    assert match, value
    digits = match.group(1)
    return 'rgb({}, {}, {})'.format(*(int(digits[index:index + 2], 16) for index in (0, 2, 4)))


def contrast(foreground, background):
    first, second = luminance(foreground), luminance(background)
    high, low = max(first, second), min(first, second)
    return (high + 0.05) / (low + 0.05)


def seconds(value):
    value = value.strip()
    assert value.endswith('s'), value
    return float(value[:-1])


# --- fixture helpers ------------------------------------------------------


def fresh(browser, width=1440, height=900, scheme='light'):
    context = browser.new_context(
        viewport={'width': width, 'height': height},
        color_scheme=scheme,
    )
    page = context.new_page()
    page.set_default_timeout(5000)
    page.on('pageerror', lambda error: PAGE_ERRORS.append(str(error)))
    page.on('console', lambda message: CONSOLE_ERRORS.append(message.text)
            if message.type == 'error' and 'favicon' not in message.text else None)
    page.goto(BASE, wait_until='networkidle')
    expect(page.locator('.login')).to_be_visible()
    return context, page


def active(page):
    return page.evaluate(
        "() => { const el = document.activeElement; return el ? (el.id + ' ' + el.className + ' ' + el.tagName).trim() : ''; }"
    )


def session_stored(page):
    return page.evaluate(f"sessionStorage.getItem({SESSION_KEY!r})")


def login(page, username, password):
    page.get_by_label('Usuario', exact=True).fill(username)
    page.get_by_label('Contraseña', exact=True).fill(password)
    page.get_by_role('button', name='Entrar', exact=True).click()


def demo_summary(page):
    return page.locator('.demo-access > summary')


# --- behaviour ------------------------------------------------------------


@check
def required_fields_move_focus_and_keep_typed_values(browser):
    context, page = fresh(browser)
    page.get_by_role('button', name='Entrar', exact=True).click()
    expect(page.locator('#login-user-error')).to_be_visible()
    assert 'login-user' in active(page), active(page)
    assert page.locator('#login-user').get_attribute('aria-invalid') == 'true'
    assert page.locator('#login-user').evaluate(
        "el => getComputedStyle(el.closest('.input-shell')).outlineStyle") == 'solid', \
        'the focused invalid field shows a visible focus ring'

    page.get_by_label('Usuario', exact=True).fill('admin')
    page.get_by_role('button', name='Entrar', exact=True).click()
    expect(page.locator('#login-password-error')).to_be_visible()
    assert 'login-password' in active(page), active(page)
    assert page.locator('#login-password').get_attribute('aria-invalid') == 'true'
    assert page.get_by_label('Usuario', exact=True).input_value() == 'admin'
    assert page.locator('.app-shell').count() == 0
    assert session_stored(page) is None
    context.close()


@check
def failed_auth_focuses_the_alert_and_stores_no_session(browser):
    context, page = fresh(browser)
    login(page, 'admin', 'incorrecta')
    alert = page.locator('.login-form .form-alert')
    expect(alert).to_be_visible()
    expect(alert).to_contain_text('Usuario o contraseña incorrectos.')
    assert 'form-alert' in active(page), active(page)
    assert page.get_by_label('Contraseña', exact=True).input_value() == 'incorrecta'
    assert session_stored(page) is None
    assert page.locator('.login').count() == 1
    assert page.evaluate('location.hash') == '#/login'
    context.close()


@check
def disabled_account_is_rejected_without_a_session(browser):
    context, page = fresh(browser)
    login(page, 'inactivo', 'inactivo')
    alert = page.locator('.login-form .form-alert')
    expect(alert).to_contain_text('La cuenta está desactivada.')
    assert 'form-alert' in active(page), active(page)
    assert session_stored(page) is None
    assert page.locator('.login').count() == 1
    context.close()


@check
def valid_demo_credentials_open_the_application(browser):
    context, page = fresh(browser)
    login(page, 'admin', 'admin')
    expect(page.locator('.app-shell')).to_be_visible()
    assert session_stored(page) is not None
    assert page.evaluate('location.hash') == '#/panel'
    context.close()


@check
def demo_credentials_stay_collapsed_behind_a_native_disclosure(browser):
    context, page = fresh(browser)
    details = page.locator('details.demo-access')
    expect(details).to_have_count(1)
    summary = demo_summary(page)
    expect(summary).to_have_text(re.compile('Acceso de demostración'))
    assert details.evaluate('el => el.open') is False
    body = page.locator('.demo-access__body')
    expect(body).to_have_count(1)
    assert body.is_visible() is False
    assert 'admin' not in page.locator('.login__panel').inner_text().lower(), 'collapsed login repeats demo credentials'

    summary.click()
    assert details.evaluate('el => el.open') is True
    expect(page.locator('.demo-access__cred')).to_contain_text('admin')
    expect(body).to_be_visible()
    page.get_by_role('button', name='Rellenar credenciales').click()
    assert page.get_by_label('Usuario', exact=True).input_value() == 'admin'
    assert page.get_by_label('Contraseña', exact=True).input_value() == 'admin'
    context.close()


@check
def login_targets_met_44px_and_one_primary_action(browser):
    context, page = fresh(browser)
    demo_summary(page).click()
    targets = {
        'submit': page.get_by_role('button', name='Entrar', exact=True),
        'password reveal': page.get_by_role('button', name='Mostrar contraseña'),
        'theme toggle': page.locator('.login .theme-toggle'),
        'demo summary': demo_summary(page),
        'demo fill': page.get_by_role('button', name='Rellenar credenciales'),
    }
    for name, locator in targets.items():
        box = locator.bounding_box()
        assert box and box['width'] >= 44 and box['height'] >= 44, (name, box)
    assert page.locator('.login .btn--primary').count() == 1, 'Entrar is the only solid action'
    context.close()


@check
def keyboard_reaches_every_login_control_and_opens_the_demo(browser):
    context, page = fresh(browser)
    seen = []
    for _ in range(7):
        page.keyboard.press('Tab')
        seen.append(active(page))
    for expected in ('theme-toggle', 'login-user', 'login-password', 'input-action', 'login-submit', 'summary'):
        assert any(expected in entry.lower() for entry in seen), (expected, seen)

    demo_summary(page).focus()
    page.keyboard.press('Enter')
    assert page.locator('details.demo-access').evaluate('el => el.open') is True
    page.keyboard.press('Tab')
    page.keyboard.press('Enter')
    assert page.get_by_label('Usuario', exact=True).input_value() == 'admin'

    page.get_by_role('button', name='Entrar', exact=True).focus()
    page.keyboard.press('Enter')
    expect(page.locator('.app-shell')).to_be_visible()
    context.close()


@check
def password_reveal_toggles_the_field_in_place(browser):
    context, page = fresh(browser)
    field = page.get_by_label('Contraseña', exact=True)
    field.fill('secreta')
    reveal = page.locator('.login-form .input-action')
    assert field.get_attribute('type') == 'password'
    reveal.click()
    assert field.get_attribute('type') == 'text'
    assert field.input_value() == 'secreta'
    assert reveal.get_attribute('aria-pressed') == 'true'
    assert reveal.get_attribute('aria-label') == 'Ocultar contraseña'
    reveal.click()
    assert field.get_attribute('type') == 'password'
    context.close()


@check
def motion_keeps_fields_visible_and_static_when_reduced(browser):
    context, page = fresh(browser)
    state = page.evaluate("""() => {
      const wrap = getComputedStyle(document.querySelector('.login__form-wrap'));
      const controls = [...document.querySelectorAll('.login-form input, .login-form button, .demo-access summary')]
        .map(el => {
          const style = getComputedStyle(el);
          return { name: el.id || el.className, animation: style.animationName, duration: style.animationDuration, delay: style.animationDelay };
        });
      return { wrap: { animation: wrap.animationName, duration: wrap.animationDuration, delay: wrap.animationDelay }, controls };
    }""")
    assert state['wrap']['animation'] == 'motion-fade', state['wrap']
    assert 0 < seconds(state['wrap']['duration']) <= 0.4, ('one brief entrance', state['wrap'])
    assert seconds(state['wrap']['delay']) == 0, state['wrap']
    for control in state['controls']:
        assert seconds(control['delay']) == 0, ('no field is delayed behind the entrance', control)
        assert control['animation'] == 'none' or seconds(control['duration']) == 0, control

    page.emulate_media(reduced_motion='reduce')
    page.reload(wait_until='networkidle')
    expect(page.locator('.login')).to_be_visible()
    reduced = page.evaluate("""() => {
      const login = document.querySelector('.login');
      const running = document.getAnimations()
        .filter(animation => animation.playState === 'running' && animation.effect && animation.effect.target
          && animation.effect.target.closest('.login'))
        .map(animation => (animation.animationName || animation.transitionProperty) + ' on ' + animation.effect.target.className);
      const durations = [document.querySelector('.login__form-wrap'), ...document.querySelectorAll('.login-form input, .demo-access summary')]
        .map(el => getComputedStyle(el).animationDuration);
      return { running, durations, visible: getComputedStyle(login).display };
    }""")
    assert reduced['visible'] != 'none', reduced
    assert reduced['running'] == [], ('reduced motion leaves no running login animation', reduced['running'])
    assert all(seconds(duration) <= 0.001 for duration in reduced['durations']), reduced['durations']
    context.close()


@check
def desktop_composition_is_a_compact_chrome_header_with_a_centred_form(browser):
    context, page = fresh(browser, 1440, 900)
    chrome = page.locator('.login__chrome')
    expect(chrome).to_be_visible()
    header = chrome.bounding_box()
    layout_width = page.evaluate('document.body.clientWidth')
    assert header['x'] == 0 and header['width'] == layout_width, header
    assert 56 <= header['height'] <= 96, header
    assert page.evaluate("getComputedStyle(document.querySelector('.login__chrome')).backgroundColor") == 'rgb(11, 35, 49)'
    expect(page.locator('.login__chrome .theme-toggle')).to_be_visible()
    expect(page.locator('.login__chrome')).to_contain_text('Asset Manager')

    assert page.locator('.login__topology').count() == 0, 'decorative topology is not rendered'
    wrap = page.locator('.login__form-wrap').bounding_box()
    assert abs(wrap['x'] + wrap['width'] / 2 - layout_width / 2) <= 2, wrap
    assert wrap['width'] <= 440, wrap
    panel = page.evaluate("getComputedStyle(document.querySelector('.login__panel')).backgroundColor")
    body = page.evaluate('getComputedStyle(document.body).backgroundColor')
    assert panel == body, (panel, body)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    context.close()


@check
def dark_theme_keeps_the_chrome_header_and_readable_login_text(browser):
    context, page = fresh(browser, 1440, 900, 'dark')
    assert page.evaluate('document.documentElement.dataset.theme') == 'dark'
    chrome = page.locator('.login__chrome')
    header = chrome.bounding_box()
    assert header['x'] == 0 and header['width'] == page.evaluate('document.body.clientWidth'), header
    background = page.evaluate("getComputedStyle(document.querySelector('.login__chrome')).backgroundColor")
    assert background == 'rgb(7, 25, 35)', background
    brand = page.locator('.login__chrome .login__brand span')
    brand_text = brand.evaluate('el => getComputedStyle(el).color')
    assert contrast(brand_text, background) >= 4.5, (brand_text, background)
    panel = page.evaluate("getComputedStyle(document.querySelector('.login__panel')).backgroundColor")
    body = page.evaluate('getComputedStyle(document.body).backgroundColor')
    assert panel == body, (panel, body)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    context.close()


@check
def mobile_360_has_no_overflow_and_keeps_targets(browser):
    context, page = fresh(browser, 360, 800)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    layout_width = page.evaluate('document.body.clientWidth')
    chrome = page.locator('.login__chrome').bounding_box()
    assert chrome['x'] == 0 and chrome['width'] == layout_width, chrome
    assert chrome['height'] <= 96, chrome
    wrap = page.locator('.login__form-wrap').bounding_box()
    assert wrap['x'] >= 0 and wrap['x'] + wrap['width'] <= layout_width, wrap
    demo_summary(page).click()
    for name, locator in {
        'submit': page.get_by_role('button', name='Entrar', exact=True),
        'password reveal': page.get_by_role('button', name='Mostrar contraseña'),
        'theme toggle': page.locator('.login .theme-toggle'),
        'demo summary': demo_summary(page),
    }.items():
        box = locator.bounding_box()
        assert box and box['width'] >= 44 and box['height'] >= 44, (name, box)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    context.close()


@check
def dark_primary_hover_keeps_text_contrast_on_login_and_shared_buttons(browser):
    context, page = fresh(browser, 1440, 900, 'dark')
    submit = page.get_by_role('button', name='Entrar', exact=True)
    submit.hover()
    page.wait_for_timeout(320)
    colours = submit.evaluate("el => { const s = getComputedStyle(el); return { background: s.backgroundColor, color: s.color, shadow: s.boxShadow }; }")
    assert contrast(colours['color'], colours['background']) >= 4.5, colours
    assert colours['shadow'] != 'none', 'dark primary hover keeps a perceivable non-colour cue'

    login(page, 'admin', 'admin')
    expect(page.locator('.app-shell')).to_be_visible()
    page.goto(BASE + '/#/panel', wait_until='networkidle')
    sibling = page.get_by_role('button', name='Nuevo activo').first
    expect(sibling).to_be_visible()
    sibling.hover()
    page.wait_for_timeout(320)
    colours = sibling.evaluate("el => { const s = getComputedStyle(el); return { background: s.backgroundColor, color: s.color }; }")
    assert contrast(colours['color'], colours['background']) >= 4.5, colours
    context.close()


@check
def custom_branding_paints_the_login_chrome(browser):
    context, page = fresh(browser)
    login(page, 'admin', 'admin')
    expect(page.locator('.app-shell')).to_be_visible()
    page.goto(BASE + '/#/configuracion/apariencia', wait_until='networkidle')
    page.locator('[data-od-id="appearance-preset-forest"]').click()
    page.locator('[data-od-id="appearance-apply"]').click()
    expect(page.locator('.appearance-feedback')).to_contain_text('Identidad aplicada')
    assert page.evaluate('document.documentElement.dataset.branding') == 'custom'
    brand = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim()")
    assert re.fullmatch(r'#[0-9a-f]{6}', brand, re.I), brand

    page.locator('.user-trigger').click()
    page.get_by_role('menuitem', name='Cerrar sesión').click()
    expect(page.locator('.login')).to_be_visible()
    chrome = page.locator('.login__chrome')
    background = chrome.evaluate('el => getComputedStyle(el).backgroundColor')
    assert background == hex_rgb(brand), (background, brand)
    text = chrome.locator('.login__brand').evaluate('el => getComputedStyle(el).color')
    assert contrast(text, background) >= 4.5, (text, background)
    expect(chrome.locator('.theme-toggle')).to_be_visible()

    duration = chrome.evaluate('el => getComputedStyle(el).transitionDuration')
    assert duration not in ('', '0s'), ('branding transition kept', duration)
    page.emulate_media(reduced_motion='reduce')
    reduced = chrome.evaluate('el => getComputedStyle(el).transitionDuration').strip()
    assert reduced.endswith('s') and float(reduced[:-1]) <= 0.001, ('reduced motion stops the branding transition', reduced)
    context.close()


# --- evidence -------------------------------------------------------------


def capture(browser):
    SHOTS.mkdir(parents=True, exist_ok=True)
    for width, height, scheme in ((1440, 900, 'light'), (1440, 900, 'dark'), (390, 844, 'light'), (390, 844, 'dark')):
        context = browser.new_context(viewport={'width': width, 'height': height}, color_scheme=scheme)
        page = context.new_page()
        page.goto(BASE, wait_until='networkidle')
        expect(page.locator('.login')).to_be_visible()
        page.wait_for_timeout(500)
        page.screenshot(path=str(SHOTS / f'login-{width}-{scheme}.png'), full_page=True)
        context.close()


def main():
    failures = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            for function in CHECKS:
                try:
                    function(browser)
                except Exception as error:  # noqa: BLE001 - the report needs every failure at once
                    failures.append((function.__name__, error))
                    print(f'FAIL {function.__name__}: {error}')
                else:
                    print(f'PASS {function.__name__}')
            if not failures:
                capture(browser)
            if PAGE_ERRORS or CONSOLE_ERRORS:
                failures.append(('no_uncaught_browser_errors', PAGE_ERRORS + CONSOLE_ERRORS))
                print(f'FAIL no_uncaught_browser_errors: {PAGE_ERRORS + CONSOLE_ERRORS}')
            else:
                print('PASS no_uncaught_browser_errors')
        finally:
            browser.close()
    if failures:
        print(f'{len(failures)} of {len(CHECKS)} checks failed')
        sys.exit(1)
    print(f'PASS {len(CHECKS)} login audit checks; screenshots in {SHOTS}')


if __name__ == '__main__':
    main()
