#!/usr/bin/env python3
"""Browser proof of the storage and first-owner steps (slice T3).

The wizard reaches these steps after the installation is claimed, so the run
needs a reachable setup service and a setup session in the browser:

    ASSET_URL=http://127.0.0.1:5173 \\
    SETUP_CLAIM_CREDENTIAL=<one-time credential> \\
    SETUP_DATABASE_URL=sqlite:////tmp/itsm-setup-browser.db \\
    python3 tests/setup-storage.browser.py

``SETUP_DATABASE_URL`` is optional. With it the run checks, applies, reloads at
the owner step (proving the reloaded wizard adopted the session CSRF token) and
creates the first owner. Without it the run proves the storage step is reachable
and survives a reload, and prints a NOTE that apply/owner were not exercised.
The owner account must not exist yet; the test uses its own username.

Environment:
  ASSET_URL               default http://127.0.0.1:5173
  SETUP_CLAIM_CREDENTIAL  one-time credential printed by the setup service
  SETUP_DATABASE_URL      optional database URL the wizard may prepare
  SETUP_OWNER_USERNAME    default setup-browser-owner
  SETUP_OWNER_PASSWORD    default setup-browser-owner-password
"""

import os
import sys

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout
except ImportError:  # pragma: no cover - environment guard
    print('SKIP: playwright is not installed for this interpreter', file=sys.stderr)
    raise SystemExit(77)

BASE = os.environ.get('ASSET_URL', 'http://127.0.0.1:5173').rstrip('/')
CREDENTIAL = os.environ.get('SETUP_CLAIM_CREDENTIAL', '')
DATABASE_URL = os.environ.get('SETUP_DATABASE_URL', '').strip()
OWNER_USERNAME = os.environ.get('SETUP_OWNER_USERNAME', 'setup-browser-owner').strip()
OWNER_PASSWORD = os.environ.get('SETUP_OWNER_PASSWORD', 'setup-browser-owner-password').strip()


def fail(message):
    print('FAIL ' + message, file=sys.stderr)
    raise SystemExit(1)


def wait(page, selector, timeout=20000):
    try:
        page.wait_for_selector(selector, timeout=timeout)
    except PlaywrightTimeout:
        fail('timed out waiting for ' + selector)


def text_of(page, selector):
    node = page.query_selector(selector)
    return node.inner_text().strip() if node else ''


def step_state(page, name):
    node = page.query_selector('[data-setup-progress="%s"]' % name)
    return node.get_attribute('data-setup-step') if node else None


def main():
    errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 1000}, locale='es-ES')
        context.add_init_script("try { localStorage.setItem('itsm.locale', 'es'); } catch (e) {}")
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))

        page.goto(BASE, wait_until='networkidle')
        if page.query_selector('[data-setup-wizard="claim"]') is not None:
            if not CREDENTIAL:
                print('SETUP_CLAIM_CREDENTIAL is empty and no setup session exists', file=sys.stderr)
                raise SystemExit(2)
            page.fill('#setup-credential', CREDENTIAL)
            page.click('#setup-claim-submit')
        wait(page, '[data-setup-wizard="claimed"]')

        # The AI step comes first. A deferred provider is the honest path here;
        # an already configured provider skips straight to storage.
        if page.query_selector('[data-setup-panel="ai"]') is not None:
            if page.query_selector('[data-setup-ai="form"]') is not None:
                page.click('#setup-ai-defer')
            elif page.query_selector('[data-setup-ai="configured"]') is not None:
                page.click('#setup-ai-continue')

        wait(page, '[data-setup-panel="storage"]')
        if page.query_selector('#setup-storage-url') is None:
            fail('the storage step has no connection field')
        if page.query_selector('#setup-storage-check') is None:
            fail('the storage step has no check action')
        if page.get_attribute('#setup-storage-apply', 'disabled') is None:
            fail('the storage step offers Apply before any check')
        if step_state(page, 'storage') != 'active':
            fail('the progress indicator does not mark storage as the current step: ' + repr(step_state(page, 'storage')))
        if step_state(page, 'ai') not in ('pending', 'done'):
            fail('the AI step has no honest state: ' + repr(step_state(page, 'ai')))

        # The engine choice is explicit; SQLite is the development option.
        labels = text_of(page, '[data-setup-engine-options]')
        if 'PostgreSQL' not in labels or 'SQLite' not in labels:
            fail('the engine choice lost one of its options: ' + repr(labels))
        if 'Recomendado' not in labels:
            fail('the engine choice does not mark PostgreSQL as recommended: ' + repr(labels))

        # Nothing overflows at phone width.
        page.set_viewport_size({'width': 390, 'height': 844})
        page.wait_for_timeout(150)
        overflow = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
        if overflow > 1:
            fail('the storage step overflows a 390px viewport by %spx' % overflow)
        page.set_viewport_size({'width': 1440, 'height': 1000})

        if not DATABASE_URL:
            page.reload(wait_until='networkidle')
            wait(page, '[data-setup-panel="storage"]')
            print('NOTE SETUP_DATABASE_URL is unset: check, apply and owner were not exercised')
        else:
            if DATABASE_URL.startswith('sqlite'):
                page.check('#setup-storage-engine-sqlite')
            else:
                page.check('#setup-storage-engine-postgres')
            page.fill('#setup-storage-url', DATABASE_URL)
            page.click('#setup-storage-check')
            wait(page, '[data-setup-storage-probe]')
            probe_class = page.get_attribute('[data-setup-storage-probe]', 'data-setup-probe-class')
            if probe_class not in ('empty', 'ours'):
                fail('the prepared database is not adoptable: ' + repr(probe_class))
            if text_of(page, '[data-setup-probe="classification"]') == '':
                fail('the probe result does not state its classification')
            if page.get_attribute('#setup-storage-apply', 'disabled') is not None:
                fail('an adoptable database still cannot be prepared')

            page.click('#setup-storage-apply')
            wait(page, '[data-setup-panel="owner"]')
            if page.query_selector('#setup-storage-url') is not None:
                fail('the database URL stayed in the form after it was applied')

            # Reload at the owner step: the resumed wizard must land here and
            # still be able to mutate, which needs the session CSRF token that
            # GET /session returns (the claim response is long gone).
            page.reload(wait_until='networkidle')
            wait(page, '[data-setup-panel="owner"]')
            if step_state(page, 'owner') != 'active':
                fail('the resumed wizard did not mark owner as the current step')

            page.fill('#setup-owner-username', OWNER_USERNAME)
            page.fill('#setup-owner-display-name', 'Setup Browser Owner')
            page.fill('#setup-owner-email', 'setup-browser@example.com')
            page.fill('#setup-owner-password', OWNER_PASSWORD)
            page.fill('#setup-owner-confirm', OWNER_PASSWORD)
            if page.get_attribute('#setup-owner-password', 'type') != 'password':
                fail('the owner password is readable on screen')
            page.click('#setup-owner-submit')
            wait(page, '[data-setup-owner="created"]', timeout=60000)
            if text_of(page, '[data-setup-owner="created"]') == '':
                fail('the created owner receipt is empty')
            if text_of(page, '[data-setup-state]') not in ('owner_ready', 'configuring'):
                fail('the owner step did not persist owner_ready: ' + repr(text_of(page, '[data-setup-state]')))
            if page.query_selector('#setup-owner-password') is not None:
                fail('the owner password field stayed in the page after submit')
            if page.evaluate('document.body.innerHTML.includes(%r)' % OWNER_PASSWORD):
                fail('the owner password leaked into the rendered page')
            if page.evaluate('JSON.stringify({...localStorage, ...sessionStorage}).includes(%r)' % OWNER_PASSWORD):
                fail('the owner password leaked into browser storage')

            # The owner exists now; a reload must not offer a second one. The
            # wizard resumes in configuration, with verification still pending.
            page.reload(wait_until='networkidle')
            wait(page, '[data-setup-panel="configure"]')
            if step_state(page, 'owner') != 'done':
                fail('the progress indicator does not mark the owner as done')
            if step_state(page, 'configuration') not in ('active', 'done'):
                fail('the configuration step is not the current step: ' + repr(step_state(page, 'configuration')))
            if step_state(page, 'verify') != 'pending':
                fail('the unfinished verification step is presented as done')

        if errors:
            fail('the page raised ' + '; '.join(errors))
        browser.close()

    print('PASS setup storage and owner steps: applied=' + str(bool(DATABASE_URL)))


if __name__ == '__main__':
    main()
