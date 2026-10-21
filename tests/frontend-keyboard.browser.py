"""Keyboard and focus regressions through the public frontend.

Covers the audited gaps: supervision device rows reachable only with a pointer,
the notification bell popup without dialog focus management, and universal
search options nesting interactive controls. Requires Python Playwright,
Chromium and a running dev server (ASSET_URL, default http://127.0.0.1:5173).
"""
import os
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('ASSET_URL', 'http://127.0.0.1:5173')


def sign_in(page):
    page.goto(BASE, wait_until='networkidle')
    page.get_by_label('Usuario', exact=True).fill('admin')
    page.get_by_label('Contraseña', exact=True).fill('admin')
    page.get_by_role('button', name='Entrar', exact=True).click()
    expect(page.locator('.app-shell')).to_be_visible()


def open_devices(page):
    page.goto(BASE + '/#/supervision/dispositivos', wait_until='networkidle')
    rows = page.locator('.mon-table__row')
    expect(rows.first).to_be_visible()
    return rows


def check_device_row_keyboard(page):
    rows = open_devices(page)
    row = rows.first
    asset_id = row.locator('.mon-table__meta').first.inner_text().split('·')[0].strip()
    expected = '#/supervision/activo/' + asset_id

    control = row.locator('th button, th a[href]')
    expect(control).to_have_count(1)
    expect(control).to_have_js_property('tagName', 'BUTTON')
    device_name = row.locator('.mon-table__title').first.inner_text().strip()
    assert control.inner_text().startswith(device_name), 'device control lost its accessible name'

    control.focus()
    expect(control).to_be_focused()
    page.evaluate("""() => {
      if (!window.__hashLog) {
        window.__hashLog = [];
        addEventListener('hashchange', () => window.__hashLog.push(location.hash));
      }
      window.__hashLog.length = 0;
    }""")
    page.keyboard.press('Enter')
    page.wait_for_function("expected => location.hash === expected", arg=expected)
    page.wait_for_function('() => window.__hashLog.length >= 1')
    assert page.evaluate('window.__hashLog') == [expected], 'device control fired the row shortcut twice'
    expect(page.locator('h1').first).to_be_visible()

    rows = open_devices(page)
    page.evaluate('() => { window.__hashLog.length = 0; }')
    rows.first.locator('td').nth(1).click()
    page.wait_for_function("expected => location.hash === expected", arg=expected)
    page.wait_for_function('() => window.__hashLog.length >= 1')
    assert page.evaluate('window.__hashLog') == [expected], 'pointer row shortcut lost after the keyboard fix'


def check_notification_bell(page):
    page.goto(BASE + '/#/panel', wait_until='networkidle')
    trigger = page.locator('[data-od-id="topbar-notifications"]')
    panel = page.locator('#notif-panel')
    expect(trigger).to_have_attribute('aria-haspopup', 'dialog')

    trigger.click()
    expect(panel).to_be_visible()
    expect(panel).to_have_attribute('role', 'dialog')
    expect(panel).not_to_have_attribute('aria-modal', 'true')
    expect(panel).to_have_attribute('aria-labelledby', 'notif-title')

    assert page.evaluate("""() => {
      const panel = document.querySelector('#notif-panel');
      const active = document.activeElement;
      return !!panel && !!active && (active === panel || panel.contains(active));
    }"""), 'opening the bell did not move focus into its dialog'

    page.keyboard.press('Escape')
    expect(panel).to_have_count(0)
    expect(trigger).to_be_focused()
    expect(trigger).to_have_attribute('aria-expanded', 'false')

    trigger.click()
    expect(panel).to_be_visible()
    assert page.evaluate("""() => {
      const panel = document.querySelector('#notif-panel');
      const active = document.activeElement;
      return !!panel && !!active && (active === panel || panel.contains(active));
    }"""), 'focus entry did not repeat on the second open'
    page.keyboard.press('Escape')
    expect(trigger).to_be_focused()


def listbox_focusables(page):
    return page.evaluate("""() => document.querySelectorAll(
      '#universal-results button, #universal-results a[href], #universal-results input,'
      + '#universal-results select, #universal-results textarea,'
      + '#universal-results [tabindex]:not([tabindex="-1"])'
    ).length""")


def check_search_palette(page):
    page.goto(BASE + '/#/panel', wait_until='networkidle')
    page.keyboard.press('Control+k')
    query = page.locator('#universal-query')
    favorite = page.locator('#search-favorite')
    expect(query).to_be_focused()
    expect(query).to_have_attribute('aria-controls', 'universal-results')

    # The listbox owns options only: entering it must not expose extra controls.
    assert listbox_focusables(page) == 0, f'{listbox_focusables(page)} focusable controls remain inside the search listbox'

    # Quick actions cannot be favorited: the footer action stays absent.
    expect(favorite).to_have_count(0)

    page.get_by_role('button', name='Favoritos', exact=True).click()
    expect(page.locator('.search-empty h3')).to_have_text('Sin favoritos')
    favorites_help = page.locator('.search-empty p').inner_text()
    assert 'Añadir a favoritos' in favorites_help, 'empty favorites state does not name the action that fills it'
    assert 'estrella' not in favorites_help and 'resultado' not in favorites_help, favorites_help
    page.get_by_role('button', name='Todo', exact=True).click()

    query.fill('AM-1043')
    options = page.locator('#universal-results [role="option"]')
    expect(options.first).to_be_visible()
    expect(favorite).to_have_count(1)
    assert page.evaluate("""() => {
      const listbox = document.querySelector('#universal-results');
      const action = document.querySelector('#search-favorite');
      return !!listbox && !!action && !listbox.contains(action);
    }"""), 'favorite action still lives inside the listbox'
    expect(favorite).to_have_attribute('aria-label', 'Añadir a favoritos: Notebook de soporte')
    expect(favorite).to_have_attribute('aria-pressed', 'false')

    nested = page.evaluate("""() => Array.from(
      document.querySelectorAll('#universal-results [role="option"]')
    ).filter((option) => option.querySelector(
      'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).length""")
    assert nested == 0, f'{nested} search options still wrap interactive controls'

    assert query.get_attribute('aria-activedescendant') == 'universal-option-0'
    expect(page.locator('#universal-results [role="option"][aria-selected="true"]')).to_have_count(1)

    favorite.click()
    expect(favorite).to_have_attribute('aria-pressed', 'true')
    assert page.evaluate('location.hash') == '#/panel', 'favoriting a result navigated away'
    expect(query).to_be_visible()

    query.fill('zzzz-no-existe')
    expect(page.locator('#universal-results [role="option"]')).to_have_count(0)
    expect(favorite).to_have_count(0)
    empty = page.locator('.search-empty')
    expect(empty).to_be_visible()
    expect(empty.locator('h3')).to_have_text('No hay coincidencias')
    assert listbox_focusables(page) == 0, f'{listbox_focusables(page)} focusable controls remain inside the empty listbox'
    assert page.evaluate("""() => {
      const listbox = document.querySelector('#universal-results');
      const message = document.querySelector('.search-empty');
      return !!listbox && !!message && !listbox.contains(message);
    }"""), 'empty state still renders inside the listbox'

    query.focus()
    for _ in range(12):
        page.keyboard.press('Tab')
        if page.evaluate("() => document.activeElement?.textContent?.trim() === 'Borrar búsqueda'"):
            break
    else:
        raise AssertionError('Borrar búsqueda is not reachable with Tab from the query')
    page.keyboard.press('Enter')
    expect(query).to_have_value('')
    expect(query).to_be_focused()
    expect(page.locator('#universal-results [role="option"]').first).to_be_visible()

    query.fill('notebook')
    option_name = lambda index: options.nth(index).locator('strong').inner_text().strip()
    expect(options.nth(0)).to_be_visible()
    assert favorite.get_attribute('aria-label').endswith(': ' + option_name(0))
    page.keyboard.press('ArrowDown')
    assert query.get_attribute('aria-activedescendant') == 'universal-option-1'
    second_name = option_name(1)
    assert favorite.get_attribute('aria-label').endswith(': ' + second_name), 'favorite action did not follow the active option'
    assert second_name != option_name(0)

    query.fill('AM-1043')
    expect(options.first).to_be_visible()
    page.keyboard.press('Enter')
    page.wait_for_function("() => location.hash === '#/activo/AM-1043'")
    expect(query).to_have_count(0)
    expect(page.locator('h1').first).to_be_visible()

    page.keyboard.press('Control+k')
    expect(query).to_be_focused()
    query.fill('AM-1043')
    expect(favorite).to_have_attribute('aria-pressed', 'true')
    page.keyboard.press('Escape')
    expect(query).to_have_count(0)


CHECKS = (
    ('supervision device row keyboard access', '#/supervision/dispositivos', check_device_row_keyboard),
    ('notification bell dialog focus', '#/panel', check_notification_bell),
    ('universal search option semantics', '#/panel', check_search_palette),
)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    for label, route, check in CHECKS:
        context = browser.new_context(viewport={'width': 1440, 'height': 1000})
        page = context.new_page()
        page.set_default_timeout(5000)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        sign_in(page)
        try:
            check(page)
        finally:
            assert not errors, (label, errors)
            context.close()
        print(f'PASS {label} ({route})')
    browser.close()
print('PASS keyboard access: device rows, notification dialog, search options and favorites')
