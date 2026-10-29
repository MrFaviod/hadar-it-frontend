"""Exercise help against a disposable migrated backend, never an existing database."""
import importlib.util
import subprocess
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

spec = importlib.util.spec_from_file_location('fixture', Path(__file__).with_name('phase4_browser.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
fixture.API_PORT = 8137
fixture.WEB_PORT = 5207
fixture.BASE = 'http://127.0.0.1:5207'


def main():
    with tempfile.TemporaryDirectory(prefix='itsm-help-') as directory:
        env = fixture.run_env(Path(directory) / 'help.db')
        try:
            for args in [
                ['-m', 'alembic', 'upgrade', 'head'],
                ['-m', 'itsm.identity.cli', 'bootstrap-superadmin', '--username', fixture.USERNAME,
                 '--name', 'Help verification'],
            ]:
                result = subprocess.run([str(fixture.PYTHON)] + args, cwd=fixture.BACKEND, env=env,
                                        capture_output=True, text=True)
                if result.returncode:
                    raise RuntimeError(f'Fixture command failed ({result.returncode}): {args}\n'
                                       + result.stdout + result.stderr)
            api = subprocess.Popen([str(fixture.PYTHON), '-m', 'uvicorn', 'itsm.main:app',
                                    '--host', '127.0.0.1', '--port', str(fixture.API_PORT)],
                                   cwd=fixture.BACKEND, env=env)
            fixture.owned.append(api)
            fixture.wait_for('http://127.0.0.1:8137/api/v1/health/live')
            web = subprocess.Popen(['npm', 'run', 'dev', '--', '--port', '5207', '--strictPort'],
                                   cwd=fixture.ROOT, env=env, stdout=subprocess.DEVNULL)
            fixture.owned.append(web)
            fixture.wait_for(fixture.BASE)
            with sync_playwright() as p:
                browser = p.chromium.launch()
                page = browser.new_page(viewport={'width': 1440, 'height': 1000})
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(fixture.BASE + '/#/login', wait_until='networkidle')
                page.get_by_label('Usuario', exact=True).fill(fixture.USERNAME)
                page.get_by_label('Contraseña', exact=True).fill(fixture.PASSWORD)
                page.get_by_role('button', name='Entrar', exact=True).click()
                expect(page.locator('.app-shell')).to_be_visible()
                page.get_by_role('link', name='Ayuda', exact=True).click()
                expect(page.get_by_role('heading', name='Ayuda', exact=True)).to_be_visible()
                expect(page.locator('.help-topic')).to_have_count(9)
                search = page.get_by_label('Buscar en la ayuda')
                search.fill('GARANTIAS')
                expect(page.locator('.help-topic')).to_have_count(1)
                expect(page.get_by_role('heading', name='Garantías y documentos')).to_be_visible()
                page.get_by_role('link', name='Abrir sección: Garantías y documentos').click()
                expect(page).to_have_url(fixture.BASE + '/#/garantias')
                # Wait for the outgoing help page to leave before navigating back:
                # the shell uses an out-in transition, so a URL change is not a mount signal.
                expect(page.locator('.help-page')).to_have_count(0)
                page.get_by_role('link', name='Ayuda', exact=True).click()
                expect(page.get_by_role('heading', name='Ayuda', exact=True)).to_be_visible()
                page.set_viewport_size({'width': 390, 'height': 844})
                for theme in ['light', 'dark']:
                    page.evaluate('(theme) => document.documentElement.dataset.theme = theme', theme)
                    page.get_by_label('Buscar en la ayuda').fill('sin coincidencia alguna')
                    try:
                        expect(page.get_by_text('No hay temas que coincidan.', exact=False)).to_be_visible()
                    except AssertionError:
                        print('HELP DIAGNOSTIC', page.evaluate('''() => {
                            const el = document.querySelector('#help-search');
                            const component = el && el.__vueParentComponent;
                            return {theme: document.documentElement.dataset.theme,
                                input: el && el.value, query: component && component.proxy.query,
                                topics: component && component.proxy.topics.length,
                                url: location.href};
                        }'''), 'ERRORS', errors)
                        raise
                    page.get_by_label('Buscar en la ayuda').fill('')
                    expect(page.locator('.help-topic')).to_have_count(9)
                    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), theme
                    page.get_by_role('button', name='Abrir navegación', exact=True).click()
                    expect(page.get_by_role('link', name='Ayuda', exact=True)).to_be_visible()
                    page.get_by_role('link', name='Ayuda', exact=True).click()
                    expect(page.get_by_role('button', name='Abrir navegación', exact=True)).to_have_attribute('aria-expanded', 'false')
                assert not errors, errors
                browser.close()
                print('PASS help: real login, nine guides, accent search, route link, 390px light/dark, drawer, no page errors')
        finally:
            fixture.stop_owned()


if __name__ == '__main__':
    main()
