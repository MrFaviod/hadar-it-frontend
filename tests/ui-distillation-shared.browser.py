"""Rendered shared hierarchy regressions using disposable owned servers."""
import importlib.util
import re
from pathlib import Path
from playwright.sync_api import expect

spec = importlib.util.spec_from_file_location('shared_fixture', Path(__file__).with_name('demo-indicator.browser.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

ROUTES = ['panel', 'inventario', 'personas', 'mantenimiento', 'supervision', 'reportes', 'garantias', 'configuracion/general']
TITLES = {
    'panel': 'Panel',
    'inventario': 'Inventario de activos',
    'personas': 'Personas',
    'mantenimiento': 'Mantenimiento e incidentes',
    'supervision': 'Supervisión de infraestructura',
    'reportes': 'Reportes',
    'garantias': 'Garantías',
    'configuracion/general': 'Configuración',
}


def drive(browser, base, label, username, password, marked, shots):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
    errors = []
    try:
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        fixture.login(page, base, username, password)
        for width, height in [(1440, 1000), (390, 844)]:
            page.set_viewport_size({'width': width, 'height': height})
            for theme in ['light', 'dark']:
                fixture.set_theme(page, theme)
                sizes = []
                for route in ROUTES:
                    # In-app navigation keeps the shared shell mounted, so the demo
                    # request budget is spent on route data instead of reload boots.
                    target = '#/' + route
                    page.evaluate("(hash) => { if (location.hash !== hash) location.hash = hash; }", target)
                    page.wait_for_function("(hash) => location.hash === hash", arg=target)
                    page.wait_for_function("() => !document.querySelector('.page-enter-active,.page-leave-active,.view-enter-active,.view-leave-active')")
                    heading = page.locator('main h1').first
                    expect(heading).to_have_text(TITLES[route])
                    size = heading.evaluate('(node) => parseFloat(getComputedStyle(node).fontSize)')
                    sizes.append((route, size))
                    assert size == (36 if width == 1440 else 28), sizes
                    underlined = page.locator('main button.text-button').evaluate_all("nodes => nodes.filter(n => n.getClientRects().length && getComputedStyle(n).textDecorationLine.includes('underline')).map(n => n.textContent.trim())")
                    assert not underlined, (route, underlined)
                    if route == 'inventario':
                        expect(page.locator('.stats-strip')).to_have_count(0)
                        # The results bar already reports totals and page position once.
                        expect(page.locator('.page-head__meta')).to_have_count(0)
                        results = page.locator('.results-bar p').inner_text()
                        assert not re.match(r'^\s*\d+\s+\d+\s', results), results
                        expect(page.locator('.toolbar .inventory-columns')).to_have_count(1)
                        # The native column disclosure must not stretch into an empty field.
                        columns = page.locator('.toolbar .inventory-columns').bounding_box()
                        assert columns['width'] <= 160, (width, columns)
                        summary = page.locator('.toolbar .inventory-columns summary')
                        summary.click()
                        dropdown = page.locator('.toolbar .inventory-columns > div')
                        expect(dropdown).to_be_visible()
                        box = dropdown.bounding_box()
                        assert box['x'] >= 0 and box['x'] + box['width'] <= width, (width, box)
                        page.screenshot(path=str(shots / f'shared-inventario-columns-{width}-{theme}.png'))
                        summary.click()
                        assert page.locator('#inventory-search').bounding_box()['y'] < height * 0.7
                    expect(page.locator('.workspace-shortcuts__current > span')).to_have_count(0)
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), route
                    page.screenshot(path=str(shots / f'shared-{route.replace("/", "-")}-{width}-{theme}.png'), full_page=True)
                    # The public demo allows 180 requests/min; browse at a human pace so
                    # each screen shows its data instead of a limiter response.
                    page.wait_for_timeout(2500)
                print(f'PASS hierarchy {width} {theme}: {sizes}', flush=True)
        assert not errors, errors
        # Restore a freshly booted shell before the real account/logout path.
        page.goto(base + '/#/panel', wait_until='networkidle')
        fixture.logout(page)
        return [label]
    finally:
        context.close()


if __name__ == '__main__':
    # The fixture owns server lifetimes and artifact paths, including cleanup.
    fixture.drive = drive
    raise SystemExit(fixture.main())
