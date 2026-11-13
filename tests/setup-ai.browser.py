#!/usr/bin/env python3
"""Browser proof of the AI step in the first-start wizard (slice T2).

The wizard only reaches the AI step after the installation is claimed with the
one-time credential, so the run needs a reachable setup service:

    ASSET_URL=http://127.0.0.1:5173 \
    SETUP_CLAIM_CREDENTIAL=<one-time credential> \
    python3 tests/setup-ai.browser.py

The defer path ("Continue without AI") always runs. When AI_FIXTURE_URL names
an OpenAI-compatible fixture provider, the same run then verifies it from the
deferred state, checks the sanitized receipt and asks the bounded assistant one
question. The provider fixture must be acceptable to the backend's endpoint
policy (the default policy refuses private addresses).
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
AI_FIXTURE_URL = os.environ.get('AI_FIXTURE_URL', '').strip()
AI_FIXTURE_MODEL = os.environ.get('AI_FIXTURE_MODEL', 'fixture-model').strip()
AI_FIXTURE_KEY = os.environ.get('AI_FIXTURE_KEY', 'fixture-key').strip()
SESSION_PATH = '/api/setup/v1/session'


def fail(message):
    print('FAIL ' + message, file=sys.stderr)
    raise SystemExit(1)


def wait(page, selector, timeout=15000):
    try:
        page.wait_for_selector(selector, timeout=timeout)
    except PlaywrightTimeout:
        fail('timed out waiting for ' + selector)


def text_of(page, selector):
    node = page.query_selector(selector)
    return node.inner_text().strip() if node else ''


def main():
    if not CREDENTIAL:
        print('SETUP_CLAIM_CREDENTIAL is empty; refusing to guess a credential', file=sys.stderr)
        raise SystemExit(2)

    errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 1000}, locale='es-ES')
        context.add_init_script("localStorage.setItem('itsm.locale', 'es')")
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))

        page.goto(BASE, wait_until='networkidle')
        wait(page, '[data-setup-wizard="claim"]')
        # The AI form cannot exist before the installation is claimed.
        if page.query_selector('[data-setup-ai]') is not None:
            fail('the AI step is visible before the installation is claimed')

        page.fill('#setup-credential', CREDENTIAL)
        page.click('#setup-claim-submit')
        wait(page, '[data-setup-wizard="claimed"]')
        wait(page, '[data-setup-ai="form"]')

        if text_of(page, '#setup-ai-title') != 'Proveedor de IA':
            fail('the AI step lost its heading: ' + repr(text_of(page, '#setup-ai-title')))
        if page.get_attribute('#setup-ai-api-key', 'type') != 'password':
            fail('the API key field is not masked')
        if page.get_attribute('#setup-ai-api-key', 'autocomplete') != 'new-password':
            fail('the API key field invites the browser to remember the secret')
        if page.query_selector('[data-setup-ai="deferred"]') is not None:
            fail('a fresh claim already shows the AI pending notice')
        if page.query_selector('[data-setup-assistant]') is not None:
            fail('the assistant panel is visible before a provider is configured')

        # A wrong provider must surface one sanitized diagnosis, focused, and
        # never the service's or the provider's own error text.
        page.fill('#setup-ai-base-url', 'https://127.0.0.1:9/v1')
        page.fill('#setup-ai-model', 'no-such-model')
        page.fill('#setup-ai-api-key', 'not-a-real-key')
        page.click('#setup-ai-verify')
        wait(page, '#setup-ai-error')
        summary = text_of(page, '#setup-ai-error')
        if 'Traceback' in summary or 'no-such-model' in summary:
            fail('the error summary echoed raw provider or service text: ' + repr(summary))
        if not summary.startswith('No se pudo verificar el proveedor'):
            fail('the error summary is missing its heading: ' + repr(summary))
        if page.evaluate('document.activeElement !== null && document.activeElement.id') != 'setup-ai-error':
            fail('focus did not move to the error summary')
        if page.input_value('#setup-ai-api-key') != '':
            fail('the rejected API key is still in the form')

        # Defer: the only honest "continue" path when no provider is verified.
        page.click('#setup-ai-defer')
        wait(page, '[data-setup-ai="deferred"]')
        if text_of(page, '[data-setup-state]') != 'ai_deferred':
            fail('deferring did not persist ai_deferred: ' + repr(text_of(page, '[data-setup-state]')))
        notice = text_of(page, '[data-setup-ai="deferred"]')
        if 'IA pendiente' not in notice:
            fail('the pending notice lost its heading: ' + repr(notice))
        if 'Pendiente' not in notice:
            fail('the pending notice does not stay visibly pending')
        if page.query_selector('[data-setup-assistant]') is not None:
            fail('deferring pretended to configure an assistant')
        if page.evaluate('document.activeElement !== null && document.activeElement.dataset.setupAi') != 'deferred':
            fail('focus did not move to the AI pending notice')

        # A wide page must not scroll sideways at phone width.
        page.set_viewport_size({'width': 390, 'height': 844})
        page.wait_for_timeout(150)
        overflow = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
        if overflow > 1:
            fail('the AI step overflows a 390px viewport by %spx' % overflow)

        if AI_FIXTURE_URL:
            page.set_viewport_size({'width': 1440, 'height': 1000})
            page.fill('#setup-ai-base-url', AI_FIXTURE_URL)
            page.fill('#setup-ai-model', AI_FIXTURE_MODEL)
            page.fill('#setup-ai-api-key', AI_FIXTURE_KEY)
            page.click('#setup-ai-verify')
            wait(page, '[data-setup-ai="configured"]', timeout=60000)

            for field in ('provider', 'model', 'tool', 'latency'):
                if not text_of(page, '[data-setup-receipt="%s"]' % field):
                    fail('the receipt is missing ' + field)
            if text_of(page, '[data-setup-receipt="tool"]') != 'get_setup_status':
                fail('the receipt does not name the tool that actually ran')
            if not text_of(page, '[data-setup-receipt="latency"]').endswith('ms'):
                fail('the receipt does not report latency in milliseconds')
            if page.query_selector('#setup-ai-api-key') is not None:
                fail('the provider form stayed visible after verification')
            if page.evaluate("document.body.innerHTML.includes(%r)" % AI_FIXTURE_KEY):
                fail('the API key leaked into the rendered page')
            if page.evaluate("JSON.stringify({...localStorage, ...sessionStorage}).includes(%r)" % AI_FIXTURE_KEY):
                fail('the API key leaked into browser storage')

            page.fill('#setup-assistant-question', '¿En qué estado está la instalación?')
            page.click('#setup-assistant-submit')
            wait(page, '[data-setup-assistant="text"]', timeout=60000)
            if not text_of(page, '[data-setup-assistant="text"]'):
                fail('the assistant answered with an empty answer area')
            if page.get_attribute('[data-setup-assistant="answer"]', 'aria-live') != 'polite':
                fail('the assistant answer area is not a polite live region')

            # The client holds the CSRF token in memory and the service issues
            # it only at claim time, so the reload comes after every write. It
            # proves the configured state and the receipt come from the server.
            page.reload(wait_until='networkidle')
            wait(page, '[data-setup-ai="configured"]')
            if text_of(page, '[data-setup-state]') != 'ai_configured':
                fail('the configured state did not survive a reload')
        else:
            # The deferred state is the server's, not a local flag.
            page.reload(wait_until='networkidle')
            wait(page, '[data-setup-ai="deferred"]')
            if text_of(page, '[data-setup-state]') != 'ai_deferred':
                fail('the deferred state did not survive a reload')
            print('NOTE AI_FIXTURE_URL is unset: the configure path was not exercised')

        if errors:
            fail('the page raised ' + '; '.join(errors))
        browser.close()

    print('PASS setup AI step: defer notice persisted, receipt and assistant checked=' + str(bool(AI_FIXTURE_URL)))


if __name__ == '__main__':
    main()
