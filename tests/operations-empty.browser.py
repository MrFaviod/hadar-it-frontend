"""Read real canonical operations in disposable demo/empty installations.

Reuse the demo-notice fixture's environment scrubbing and owned-server lifecycle.
No metrics, directory records or operational results are fabricated in the UI.
"""
import importlib.util
from pathlib import Path

from playwright.sync_api import expect

spec = importlib.util.spec_from_file_location(
    "demo_fixture", Path(__file__).with_name("demo-indicator.browser.py")
)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


def visit(page, base, route, heading):
    page.goto(base + "/#/" + route, wait_until="networkidle")
    expect(page.get_by_role("heading", name=heading, exact=True)).to_be_visible()


def drive(browser, base, label, username, password, marked, shots):
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    errors = []
    try:
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        fixture.login(page, base, username, password)
        visit(page, base, "panel", "Panel")
        expect(page.locator('[data-od-id="dashboard-widget-inventory"]')).to_be_visible()
        inventory = page.locator('[data-od-id="dashboard-widget-inventory"] .noc-inventory strong')
        assert inventory.all_text_contents()[0] == ("8" if marked else "0")
        # The user's layout is persisted through the real workspace API.
        page.get_by_role("button", name="Personalizar", exact=True).click()
        with page.expect_response(lambda response: '/workspace/state' in response.url and response.request.method == 'PUT') as saved:
            page.get_by_role("button", name="Ocultar Resumen del inventario", exact=True).click()
        assert saved.value.ok, saved.value.status
        expect(page.locator('[data-od-id="dashboard-preference-inventory"]')).to_have_count(0)
        page.reload(wait_until="networkidle")
        expect(page.get_by_role("heading", name="Panel", exact=True)).to_be_visible()
        expect(page.locator('[data-od-id="dashboard-widget-inventory"]')).to_have_count(0)
        page.get_by_role("button", name="Personalizar", exact=True).click()
        with page.expect_response(lambda response: '/workspace/state' in response.url and response.request.method == 'PUT') as saved:
            page.get_by_role("button", name="Restaurar distribución inicial", exact=True).click()
        assert saved.value.ok, saved.value.status
        expect(page.locator('[data-od-id="dashboard-widget-inventory"]')).to_be_visible()
        page.get_by_role("button", name="Cerrar ajustes", exact=True).click()

        if marked:
            maintenance = page.locator('[data-od-id="dashboard-widget-maintenance"]')
            expect(maintenance.locator('.noc-work').first).to_be_visible()
            expect(page.locator('[data-od-id="dashboard-widget-warranties"] .noc-work').first).to_be_visible()
            # Enable the optional incidents widget; do not show every widget by default.
            page.get_by_role("button", name="Personalizar", exact=True).click()
            article = page.locator('.noc-hidden-widgets article').filter(has_text="Incidencias activas")
            article.get_by_role("button", name="Añadir", exact=True).click()
            expect(page.locator('[data-od-id="dashboard-widget-incidents"] .noc-alert-list a')).to_have_count(2)
            page.get_by_role("button", name="Cerrar ajustes", exact=True).click()

        visit(page, base, "inventario", "Inventario de activos")
        if marked:
            expect(page.get_by_role("heading", name="El inventario está vacío", exact=True)).to_have_count(0)
        else:
            expect(page.get_by_role("heading", name="El inventario está vacío", exact=True)).to_be_visible()
        page.locator('#inventory-search').fill("zz-no-matching-asset-874")
        expect(page.get_by_role("heading", name="No hay activos con estos filtros", exact=True)).to_be_visible()
        page.locator('#inventory-search').fill("")
        if not marked:
            expect(page.get_by_role("heading", name="El inventario está vacío", exact=True)).to_be_visible()

        visit(page, base, "personas", "Personas")
        if marked:
            expect(page.get_by_text("Alex Rivera", exact=True)).to_be_visible()
        else:
            expect(page.get_by_role("heading", name="Todavía no hay personas registradas", exact=True)).to_be_visible()
            expect(page.get_by_role("button", name="Limpiar filtros", exact=True)).to_have_count(0)
        page.get_by_label("Buscar personas", exact=True).fill("zz-no-matching-person-874")
        expect(page.get_by_role("heading", name="No hay personas con estos filtros", exact=True)).to_be_visible()
        page.get_by_label("Buscar personas", exact=True).fill("")
        if not marked:
            expect(page.get_by_role("heading", name="Todavía no hay personas registradas", exact=True)).to_be_visible()

        visit(page, base, "mantenimiento", "Mantenimiento e incidentes")
        if not marked:
            for tab, text in [
                ("Agenda", "Todavía no hay trabajos preventivos programados."),
                ("Intervenciones", "Todavía no hay intervenciones registradas."),
                ("Incidentes", "Todavía no hay incidentes registrados."),
            ]:
                page.get_by_role("tab", name=tab, exact=False).click()
                expect(page.get_by_text(text, exact=True)).to_be_visible()
                expect(page.get_by_role("button", name="Quitar filtros", exact=True)).to_have_count(0)
        else:
            page.get_by_role("tab", name="Incidentes", exact=False).click()
            expect(page.get_by_text("Todavía no hay incidentes registrados.", exact=True)).to_have_count(0)
            expect(page.locator('[data-maint-filter="query"]')).to_be_visible()
            page.locator('[data-maint-filter="query"]').fill("zz-no-matching-incident-874")
            expect(page.get_by_text("Ningún incidente coincide con los filtros activos.", exact=True)).to_be_visible()
            page.get_by_role("button", name="Quitar filtros", exact=True).click()
            expect(page.get_by_text("Ningún incidente coincide con los filtros activos.", exact=True)).to_have_count(0)

        for width, height in [(1440, 1000), (390, 844)]:
            page.set_viewport_size({"width": width, "height": height})
            for theme in ["light", "dark"]:
                fixture.set_theme(page, theme)
                for route, heading in [("panel", "Panel"), ("inventario", "Inventario de activos"),
                                       ("personas", "Personas"), ("mantenimiento", "Mantenimiento e incidentes")]:
                    visit(page, base, route, heading)
                    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), (label, route, width, theme)
                    page.screenshot(path=str(shots / f"operations-{label}-{route}-{width}-{theme}.png"), full_page=True)
        assert not errors, errors
        fixture.logout(page)
        print(f"PASS operations {label}: real canonical reads, saved widgets, truthful empties/filters, 1440/390 light/dark")
        return [label]
    finally:
        context.close()


if __name__ == "__main__":
    fixture.drive = drive
    raise SystemExit(fixture.main())
