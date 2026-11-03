"""Configuration hierarchy through the disposable installation fixture."""
import importlib.util
from pathlib import Path
from playwright.sync_api import expect

spec = importlib.util.spec_from_file_location('config_fixture', Path(__file__).with_name('demo-indicator.browser.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


def drive(browser, base, label, username, password, marked, shots):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
    errors = []
    try:
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        fixture.login(page, base, username, password)
        page.goto(base + '/#/configuracion/general', wait_until='networkidle')
        expect(page.locator('#config-general-title')).to_be_visible()
        page.wait_for_function("() => !document.querySelector('.page-enter-active,.page-leave-active,.view-enter-active,.view-leave-active')")
        expect(page.locator('.config-section .config-section')).to_have_count(0)
        expect(page.locator('[data-od-id="search-settings"] .eyebrow')).to_have_count(0)
        expect(page.locator('.noc-preference-intro p')).to_have_count(0)
        for width, height in [(1440, 1000), (390, 844)]:
            page.set_viewport_size({'width': width, 'height': height})
            for theme in ['light', 'dark']:
                fixture.set_theme(page, theme)
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                for locale, title in [('es', 'Búsqueda'), ('en', 'Search')]:
                    page.evaluate("async tag => { await window.ItsmI18n.loadBundle(tag); window.ItsmI18n.setLocale(tag); }", locale)
                    expect(page.locator('#search-settings-title')).to_have_text(title)
                    expect(page.locator('[data-od-id="dashboard-preferences"] .config-section__head h2')).to_have_text('Panel' if locale == 'es' else 'Dashboard')
                    for section in ['#config-general-title', '[data-od-id="search-settings"]', '[data-od-id="dashboard-preferences"]']:
                        page.locator(section).scroll_into_view_if_needed()
                        page.screenshot(path=str(shots / f'config-{locale}-{width}-{theme}-{section.split("\"")[1] if "\"" in section else "identity"}.png'))
                    page.screenshot(path=str(shots / f'config-general-{locale}-{width}-{theme}.png'), full_page=True)
        assert not errors, errors
        page.evaluate("async () => { await window.ItsmI18n.loadBundle('es'); window.ItsmI18n.setLocale('es'); }")
        expect(page.locator('#search-settings-title')).to_have_text('Búsqueda')
        fixture.logout(page)
        return [label]
    finally:
        context.close()


if __name__ == '__main__':
    fixture.drive = drive
    raise SystemExit(fixture.main())
