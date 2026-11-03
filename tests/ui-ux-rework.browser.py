"""Public UI regressions against disposable demo/ordinary installations.

Run: python3 tests/ui-ux-rework.browser.py. Reuses the owned-server fixture;
never reads .env, uses existing instance credentials or changes server policy.
"""
import importlib.util
from pathlib import Path

from playwright.sync_api import expect

spec = importlib.util.spec_from_file_location(
    "ui_fixture", Path(__file__).with_name("demo-indicator.browser.py")
)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


def visit(page, base, route, title):
    page.goto(base + "/#/" + route, wait_until="networkidle")
    expect(page.get_by_role("heading", name=title, exact=True)).to_be_visible()
    page.wait_for_function("() => !document.querySelector('.page-enter-active,.page-leave-active')")


def drive(browser, base, label, username, password, marked, shots):
    context = browser.new_context(viewport={"width": 1440, "height": 1000}, reduced_motion="reduce")
    errors = []
    try:
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        fixture.login(page, base, username, password)
        visit(page, base, "panel", "Panel")
        # Panel has site/category/period filters, not administrative status/location.
        expect(page.locator('#shared-status')).to_have_count(0)
        expect(page.locator('#shared-location')).to_have_count(0)
        print('PASS panel: no ineffective administrative filter controls', flush=True)

        visit(page, base, "inventario", "Inventario de activos")
        # Inventory already owns status selection in its toolbar.
        expect(page.locator('#shared-status')).to_have_count(0)
        expect(page.locator('#shared-location')).to_have_count(0)
        status = page.locator('#inventory-status-filter')
        expect(status).to_have_count(1)
        chosen_status = status.locator('option').nth(1).get_attribute('value')
        status.select_option(chosen_status)
        expect(status).to_have_value(chosen_status)
        status.select_option('all')
        expect(page.locator('#inventory-search')).to_be_visible()
        print('PASS inventory: one canonical status control; search preserved', flush=True)

        # Functional summary labels remain readable at desktop and mobile sizes.
        for selector in ['.sidebar__label', '.results-bar p']:
            sizes = page.locator(selector).evaluate_all(
                '(nodes) => nodes.map(n => parseFloat(getComputedStyle(n).fontSize))'
            )
            assert sizes and min(sizes) >= 11, (selector, sizes)

        # Favorite icons must not depend on missing font glyphs.
        expect(page.locator('[data-od-id="favorite-current"] svg')).to_have_count(1)

        # Real account popover: keyboard opens into an action; Escape restores focus.
        trigger = page.locator('.user-trigger')
        trigger.focus()
        page.keyboard.press('Enter')
        first = page.locator('.user-popover [role="menuitem"]').first
        expect(first).to_be_focused()
        page.keyboard.press('End')
        expect(page.get_by_role('menuitem', name='Cerrar sesión')).to_be_focused()
        page.keyboard.press('Home')
        expect(first).to_be_focused()
        page.keyboard.press('ArrowUp')
        expect(page.get_by_role('menuitem', name='Cerrar sesión')).to_be_focused()
        page.keyboard.press('ArrowDown')
        expect(first).to_be_focused()
        page.keyboard.press('Escape')
        expect(trigger).to_be_focused()
        expect(page.locator('.user-popover')).to_have_count(0)
        trigger.focus()
        page.keyboard.press('ArrowUp')
        expect(page.get_by_role('menuitem', name='Cerrar sesión')).to_be_focused()
        locale = page.locator('.user-popover select')
        locale.focus()
        page.keyboard.press('Escape')
        expect(trigger).to_be_focused()
        expect(page.locator('.user-popover')).to_have_count(0)
        print('PASS account: arrows/Home/End, native locale control, local Escape focus return', flush=True)

        for width, height in [(1440, 1000), (768, 1024), (390, 844), (360, 800)]:
            page.set_viewport_size({'width': width, 'height': height})
            for theme in ['light', 'dark']:
                fixture.set_theme(page, theme)
                visit(page, base, 'configuracion/general', 'Configuración')
                if width <= 768:
                    picker = page.locator('#config-section-select')
                    expect(picker).to_be_visible()
                    expect(page.locator('.config-nav')).not_to_be_visible()
                    assert picker.bounding_box()['y'] < height, 'section navigation below first viewport'
                    picker.select_option('apariencia')
                    expect(page).to_have_url(base + '/#/configuracion/apariencia')
                    expect(page.get_by_role('heading', name='Apariencia', exact=True)).to_be_visible()
                    expect(picker).to_have_value('apariencia')
                else:
                    expect(page.locator('.config-nav')).to_be_visible()
                    expect(page.locator('#config-section-select')).not_to_be_visible()
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                page.screenshot(path=str(shots / f'ux-{label}-settings-{width}-{theme}.png'), full_page=True)
                visit(page, base, 'inventario', 'Inventario de activos')
                label_sizes = page.locator('.results-bar p').evaluate_all(
                    '(nodes) => nodes.map(n => parseFloat(getComputedStyle(n).fontSize))'
                )
                assert min(label_sizes) >= 11, label_sizes
                if width <= 390:
                    expect(page.locator('.stats-strip')).to_have_count(0)
                    assert page.locator('#inventory-search').bounding_box()['y'] < height, 'search requires scrolling past summary'
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                page.screenshot(path=str(shots / f'ux-{label}-inventory-{width}-{theme}.png'), full_page=True)
        assert not errors, errors
        fixture.logout(page)
        print(f'PASS {label}: settings navigation, compact inventory, themes/widths, logout; pageerrors=0', flush=True)
        return [label]
    finally:
        context.close()


if __name__ == '__main__':
    fixture.drive = drive
    raise SystemExit(fixture.main())
