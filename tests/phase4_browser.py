"""Phase 4 real inventory smoke against an isolated SQLite backend.

Starts its own loopback uvicorn (fresh temporary SQLite, fresh migrations and a
disposable bootstrapped administrator) plus the Vite dev server, drives the real
Vue inventory through Chromium, and stops only the processes it owns.

Required: playwright + Chromium on the workstation. No .env file and no Docker.
"""
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT.parent / 'backend'
PYTHON = BACKEND / '.venv' / 'bin' / 'python'
API_PORT = int(os.environ.get('ITSM_PHASE4_API_PORT', '8123'))
WEB_PORT = int(os.environ.get('ITSM_PHASE4_WEB_PORT', '5199'))
BASE = 'http://127.0.0.1:%d' % WEB_PORT
USERNAME = 'phase4.admin'
PASSWORD = 'Phase4-Smoke-Pass-9f'
suffix = uuid.uuid4().hex[:8]
NAME = 'Notebook smoke ' + suffix

owned = []


def wait_for(url, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=2)
            return
        except Exception:
            try:
                urllib.request.urlopen(url, timeout=2)
                return
            except Exception:
                time.sleep(0.4)
    raise RuntimeError('timeout waiting for ' + url)


def stop_owned():
    for process in reversed(owned):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()


def run_env(database):
    env = dict(os.environ)
    env.update({
        'ITSM_DATABASE_URL': 'sqlite+pysqlite:///' + str(database),
        'ITSM_ENVIRONMENT': 'development',
        'ITSM_AUTH_ORIGIN': BASE,
        'ITSM_AUTH_COOKIE_SECURE': 'false',
        'ITSM_BOOTSTRAP_PASSWORD': PASSWORD,
        'ITSM_DEV_API_URL': 'http://127.0.0.1:%d' % API_PORT,
    })
    return env


def free_port(port):
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', port))


def main():
    workdir = Path(tempfile.mkdtemp(prefix='phase4-smoke-'))
    database = workdir / 'smoke.db'
    env = run_env(database)
    try:
        subprocess.run([str(PYTHON), '-m', 'alembic', 'upgrade', 'head'], cwd=BACKEND, env=env, check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        subprocess.run([str(PYTHON), '-m', 'itsm.identity.cli', 'bootstrap-admin', '--username', USERNAME,
                        '--name', 'Fase 4 Smoke'], cwd=BACKEND, env=env, check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        api = subprocess.Popen([str(PYTHON), '-m', 'uvicorn', 'itsm.main:app', '--host', '127.0.0.1',
                                '--port', str(API_PORT), '--log-level', 'warning'], cwd=BACKEND, env=env)
        owned.append(api)
        wait_for('http://127.0.0.1:%d/api/v1/health/live' % API_PORT)
        web = subprocess.Popen(['npm', 'run', 'dev', '--', '--port', str(WEB_PORT), '--strictPort'],
                               cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
        owned.append(web)
        wait_for(BASE + '/index.html')

        with sync_playwright() as p:
            browser = p.chromium.launch()
            context = browser.new_context(viewport={'width': 1440, 'height': 1000})
            page = context.new_page()
            console = []
            failures = []
            page.on('pageerror', lambda error: failures.append(str(error)))
            page.on('console', lambda message: console.append(message.text) if message.type == 'error' else None)

            page.goto(BASE + '/#/login', wait_until='networkidle')
            page.get_by_label('Usuario', exact=True).fill(USERNAME)
            page.get_by_label('Contraseña', exact=True).fill(PASSWORD)
            page.get_by_role('button', name='Entrar', exact=True).click()
            expect(page.locator('.app-shell')).to_be_visible()
            console.clear()  # the pre-login session probe answers 401 by design

            page.goto(BASE + '/#/inventario', wait_until='networkidle')
            expect(page.get_by_role('heading', name='Inventario de activos', exact=True)).to_be_visible()
            expect(page.get_by_text('Consultando el inventario del servidor…')).to_have_count(0, timeout=15000)

            page.locator('[data-od-id="create-asset"]').click()
            dialog = page.get_by_role('dialog')
            expect(dialog).to_be_visible()
            dialog.locator('#asset-quick-name').fill(NAME)
            dialog.locator('#asset-editor-category').select_option(label='Notebooks')
            dialog.locator('.editor-toggle').click()
            dialog.locator('#asset-tech-ram').fill('32')
            dialog.locator('#asset-tech-os').fill('Linux')
            dialog.locator('#asset-tech-mac').fill('AA:BB:CC:DD:EE:01')
            dialog.locator('#asset-adv-cost').fill('1250.50')
            dialog.get_by_role('button', name='Registrar activo', exact=True).click()
            expect(page.get_by_role('dialog')).to_have_count(0, timeout=15000)
            expect(page.get_by_text(NAME).first).to_be_visible()

            page.reload(wait_until='networkidle')
            expect(page.get_by_text(NAME).first).to_be_visible()
            page.get_by_text(NAME).first.click()
            expect(page.get_by_role('heading', name='Historial del servidor', exact=True)).to_be_visible()
            info = page.locator('.info-panel').inner_text()
            assert 'memoria ram' in info.lower(), info
            expect(page.locator('.detail-field--cost')).to_contain_text('1250.50')
            expect(page.get_by_role('heading', name='Archivar conserva el registro', exact=True)).to_be_visible()

            # Duplicate keeps a server-assigned identifier and quick code.
            page.get_by_role('button', name='Editar activo', exact=True).click()
            editor = page.get_by_role('dialog')
            editor.locator('#asset-quick-name').fill(NAME + ' editado')
            editor.get_by_role('button', name='Guardar cambios', exact=True).click()
            expect(page.get_by_role('dialog')).to_have_count(0, timeout=15000)
            expect(page.get_by_role('heading', name=NAME + ' editado', exact=True)).to_be_visible()

            page.screenshot(path=str(workdir / 'detail-1440-light.png'), full_page=True)

            page.locator('[data-od-id="archive-asset"]').first.click()
            lifecycle = page.get_by_role('dialog')
            lifecycle.get_by_label('Motivo').fill('Equipo retirado del servicio')
            lifecycle.locator('button[type="submit"]').click()
            expect(page.get_by_role('dialog')).to_have_count(0, timeout=15000)
            expect(page.get_by_text('Archivado', exact=False).first).to_be_visible()
            page.locator('[data-od-id="restore-asset"]').first.click()
            page.get_by_role('dialog').locator('button[type="submit"]').click()
            expect(page.get_by_role('dialog')).to_have_count(0, timeout=15000)

            page.goto(BASE + '/#/configuracion/categorias', wait_until='networkidle')
            expect(page.get_by_role('heading', name='Categorías de activos', exact=True)).to_be_visible()
            expect(page.get_by_role('article').filter(has_text='Notebooks').first).to_be_visible()
            page.locator('[data-od-id="create-server-category"]').click()
            category_dialog = page.get_by_role('dialog')
            category_dialog.get_by_label('Nombre', exact=True).fill('Kioscos smoke')
            category_dialog.get_by_label('Prefijo del código rápido', exact=True).fill('KIO')
            category_dialog.get_by_label('Tipo de equipo', exact=True).fill('Kiosco')
            category_dialog.locator('button[type="submit"]').click()
            expect(page.get_by_role('dialog')).to_have_count(0, timeout=15000)
            page.reload(wait_until='networkidle')
            expect(page.get_by_role('article').filter(has_text='Kioscos smoke').first).to_be_visible()
            page.screenshot(path=str(workdir / 'config-categorias-1440-light.png'), full_page=True)

            page.goto(BASE + '/#/configuracion/activos', wait_until='networkidle')
            expect(page.get_by_role('heading', name='Biblioteca de campos', exact=True)).to_be_visible()
            expect(page.get_by_role('article').filter(has_text='Memoria RAM')).to_be_visible()
            page.get_by_role('tab', name='Identificación', exact=True).click()
            expect(page.get_by_text('Entorno del servidor', exact=True)).to_be_visible()
            expect(page.get_by_text('Modo de operación', exact=True)).to_have_count(0)
            expect(page.get_by_text('desarrollo', exact=True).first).to_be_visible()
            page.screenshot(path=str(workdir / 'config-1440-light.png'), full_page=True)

            # Dark theme and a narrow viewport must keep the real inventory usable.
            page.locator('.app-shell .theme-toggle').first.click()
            page.goto(BASE + '/#/inventario', wait_until='networkidle')
            expect(page.get_by_text(NAME + ' editado').first).to_be_visible()
            page.screenshot(path=str(workdir / 'inventory-1440-dark.png'), full_page=True)
            page.set_viewport_size({'width': 390, 'height': 844})
            page.reload(wait_until='networkidle')
            expect(page.get_by_role('heading', name='Inventario de activos', exact=True)).to_be_visible()
            overflow = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            assert overflow <= 1, 'horizontal overflow at 390px: %s' % overflow
            page.screenshot(path=str(workdir / 'inventory-390-dark.png'), full_page=True)

            assert not failures, 'page errors: %s' % failures
            assert not console, 'console errors: %s' % console

            page.locator('.user-trigger').click()
            page.get_by_role('menuitem', name='Cerrar sesión').click()
            expect(page.get_by_role('heading', name='Iniciar sesión', exact=True)).to_be_visible()
            context.close()
            browser.close()
        print('PASS phase 4 real inventory create/edit/archive/restore, server catalog, dark and 390px')
        print('screenshots:', workdir)
    finally:
        stop_owned()
        if os.environ.get('ITSM_PHASE4_KEEP') != '1':
            shutil.rmtree(workdir, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
