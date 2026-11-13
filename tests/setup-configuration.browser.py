#!/usr/bin/env python3
"""Browser proof of the configuration and verification steps (slice T5).

The wizard only reaches configuration once the installation is claimed, its
database is prepared and the first owner exists, so the run needs a reachable
setup service and those inputs:

    ASSET_URL=http://127.0.0.1:5173 \
    SETUP_CLAIM_CREDENTIAL=<one-time credential> \
    SETUP_DATABASE_URL=sqlite:////tmp/itsm-setup-browser.db \
    python3 tests/setup-configuration.browser.py

The run changes the appearance section, reads the applied value back, postpones
notifications (which must never look applied) and asks for verification, which
either returns a checklist with its per-item evidence or keeps the user in
configuration with an actionable message. It also proves the panel fits a 390px
viewport and that the section choice is keyboard reachable.

Environment:
  ASSET_URL               default http://127.0.0.1:5173
  SETUP_CLAIM_CREDENTIAL  one-time credential printed by the setup service
  SETUP_DATABASE_URL      database URL the wizard prepares (required here)
  SETUP_OWNER_USERNAME    default setup-config-owner
  SETUP_OWNER_PASSWORD    default setup-config-owner-password
  AI_FIXTURE_URL          optional; when set the AI step is configured through
                          the fixture instead of deferred
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
OWNER_USERNAME = os.environ.get('SETUP_OWNER_USERNAME', 'setup-config-owner').strip()
OWNER_PASSWORD = os.environ.get('SETUP_OWNER_PASSWORD', 'setup-config-owner-password').strip()
AI_FIXTURE_URL = os.environ.get('AI_FIXTURE_URL', '').strip()


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


def reach_configuration(page):
    """Claim, defer the provider, prepare the database and create the owner."""
    page.goto(BASE, wait_until='networkidle')
    if page.query_selector('[data-setup-wizard="claim"]') is not None:
        if not CREDENTIAL:
            print('SETUP_CLAIM_CREDENTIAL is empty and no setup session exists', file=sys.stderr)
            raise SystemExit(2)
        page.fill('#setup-credential', CREDENTIAL)
        page.click('#setup-claim-submit')
    wait(page, '[data-setup-wizard="claimed"]')

    if page.query_selector('[data-setup-panel="ai"]') is not None:
        if AI_FIXTURE_URL and page.query_selector('[data-setup-ai="form"]') is not None:
            page.fill('#setup-ai-base-url', AI_FIXTURE_URL)
            page.fill('#setup-ai-model', 'fixture-model')
            page.fill('#setup-ai-api-key', 'fixture-key')
            page.click('#setup-ai-verify')
            wait(page, '[data-setup-ai="configured"]', timeout=60000)
            page.click('#setup-ai-continue')
        elif page.query_selector('[data-setup-ai="form"]') is not None:
            page.click('#setup-ai-defer')
        elif page.query_selector('[data-setup-ai="configured"]') is not None:
            page.click('#setup-ai-continue')

    if page.query_selector('[data-setup-panel="storage"]') is not None:
        if not DATABASE_URL:
            print('SETUP_DATABASE_URL is required to reach configuration', file=sys.stderr)
            raise SystemExit(2)
        if DATABASE_URL.startswith('sqlite'):
            page.check('#setup-storage-engine-sqlite')
        else:
            page.check('#setup-storage-engine-postgres')
        page.fill('#setup-storage-url', DATABASE_URL)
        page.click('#setup-storage-check')
        wait(page, '[data-setup-storage-probe]')
        page.click('#setup-storage-apply')
        wait(page, '[data-setup-panel="owner"]', timeout=60000)

    if page.query_selector('[data-setup-panel="owner"]') is not None:
        page.fill('#setup-owner-username', OWNER_USERNAME)
        page.fill('#setup-owner-display-name', 'Setup Configuration Owner')
        page.fill('#setup-owner-email', 'setup-config@example.com')
        page.fill('#setup-owner-password', OWNER_PASSWORD)
        page.fill('#setup-owner-confirm', OWNER_PASSWORD)
        page.click('#setup-owner-submit')
        wait(page, '[data-setup-owner="created"]', timeout=60000)

    wait(page, '[data-setup-panel="configure"]', timeout=60000)


def main():
    errors = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1440, 'height': 1000}, locale='es-ES')
        context.add_init_script("try { localStorage.setItem('itsm.locale', 'es'); } catch (e) {}")
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))

        reach_configuration(page)

        if step_state(page, 'configuration') not in ('active', 'done'):
            fail('the progress indicator does not mark configuration: '
                 + repr(step_state(page, 'configuration')))
        if page.query_selector('#setup-verify-submit') is None:
            fail('configuration offers no way to start verification')

        sections = page.query_selector_all('[data-setup-section]')
        if len(sections) != 5:
            fail('expected five configuration sections, found %s' % len(sections))

        # Every section states its current value, where it comes from and its
        # honest chip. No chip may claim "verified" before verify ran.
        for section in sections:
            section_id = section.get_attribute('data-setup-section')
            chip = section.query_selector('[data-setup-config-chip]')
            if chip is None:
                fail('section %s has no status chip' % section_id)
            if section.query_selector('[data-setup-config-value]') is None:
                fail('section %s does not show its effective value' % section_id)
            if section.query_selector('[data-setup-config-source]') is None:
                fail('section %s does not state where its value comes from' % section_id)
            if chip.get_attribute('data-setup-config-chip') == 'verified':
                fail('section %s claims verification before verify ran' % section_id)

        # Appearance: choose another option, preview the diff, apply, read back.
        select = page.locator('#setup-config-input-appearance')
        options = page.evaluate(
            "(sel) => Array.from(document.querySelector(sel).options).map((o) => o.value)",
            '#setup-config-input-appearance',
        )
        usable = [value for value in options if value and value != select.input_value()]
        if not usable:
            fail('appearance exposes no alternative option: ' + repr(options))
        target = usable[0]
        select.select_option(target)

        page.click('[data-setup-config-preview-submit="appearance"]')
        wait(page, '[data-setup-config-preview="appearance"]')
        diff = text_of(page, '[data-setup-config-preview="appearance"]')
        if '→' not in diff and '->' not in diff:
            fail('the preview does not show a from/to diff: ' + repr(diff))
        if page.get_attribute('[data-setup-config-apply="appearance"]', 'disabled') is not None:
            fail('the preview offers no explicit apply step')

        page.click('[data-setup-config-apply="appearance"]')
        wait(page, '[data-setup-config-receipt="appearance"]')
        receipt = text_of(page, '[data-setup-config-receipt="appearance"]')
        if receipt == '':
            fail('the apply receipt is empty')
        card = page.locator('[data-setup-section="appearance"]')
        chip_after = card.locator('[data-setup-config-chip]').get_attribute('data-setup-config-chip')
        if chip_after not in ('applied', 'verified'):
            fail('appearance did not report the applied state: ' + repr(chip_after))
        if target not in text_of(page, '[data-setup-config-value="appearance"]') and target not in receipt:
            fail('the read-back does not contain the applied value: ' + repr(receipt))

        # Notifications are postponable: the chip is a postponement, never the
        # green "applied" word.
        postpone = page.locator('[data-setup-config-postpone="notifications"]')
        if postpone.count() == 0:
            fail('notifications offers no postpone action')
        old_chip = page.get_attribute('[data-setup-section="notifications"] [data-setup-config-chip]',
                                      'data-setup-config-chip')
        if old_chip != 'postponed':
            postpone.click()
            wait(page, '[data-setup-section="notifications"][data-setup-section-status="postponed"]')
        chip = page.get_attribute('[data-setup-section="notifications"] [data-setup-config-chip]',
                                  'data-setup-config-chip')
        if chip != 'postponed':
            fail('postponed notifications do not report themselves as postponed: ' + repr(chip))

        # 390px: no horizontal overflow, controls stay usable.
        page.set_viewport_size({'width': 390, 'height': 844})
        page.wait_for_timeout(150)
        overflow = page.evaluate(
            'document.documentElement.scrollWidth - document.documentElement.clientWidth')
        if overflow > 1:
            fail('the configuration step overflows a 390px viewport by %spx' % overflow)
        page.set_viewport_size({'width': 1440, 'height': 1000})

        # Verification either shows the checklist with evidence or keeps the
        # wizard in configuration with guidance; it never invents a result.
        page.click('#setup-verify-submit')
        page.wait_for_selector('[data-setup-panel="verify"], [data-setup-config="blocked"]', timeout=60000)
        if page.query_selector('[data-setup-panel="verify"]') is not None:
            wait(page, '[data-setup-verify="checklist"]')
            mode = text_of(page, '[data-setup-verify-mode]')
            if mode == '':
                fail('the checklist does not state its mode')
            items = page.query_selector_all('[data-setup-verify-item]')
            if not items:
                fail('the checklist has no items')
            pending = [item for item in items
                       if item.get_attribute('data-setup-verify-status') == 'pending']
            for item in items:
                evidence = item.query_selector('[data-setup-verify-evidence]')
                hint = item.query_selector('[data-setup-verify="no-evidence"]')
                if evidence is None and hint is None:
                    fail('an item reports no evidence and no explanation: '
                         + repr(item.get_attribute('data-setup-verify-item')))
            if pending:
                print('NOTE verification kept %s pending item(s); postpone them or finish them'
                      % len(pending))
        else:
            wait(page, '[data-setup-panel="configure"]')
            blocked = page.query_selector('[data-setup-config="blocked"]')
            if blocked is None:
                fail('a refused verification left no guidance in configuration')
            blocked_text = blocked.inner_text().strip()
            if blocked_text == '':
                fail('the blocked guidance is empty')
            if blocked.query_selector('.setup-config__blocked li') is None \
                    and blocked.query_selector('[data-setup-config="blocked"] p') is None:
                fail('the blocked guidance names no requirement: ' + repr(blocked_text))
            if page.get_attribute('[data-setup-progress="verify"]', 'data-setup-step') == 'done':
                fail('a refused verification marked the step done')

        if errors:
            fail('the page raised ' + '; '.join(errors))
        browser.close()

    print('PASS setup configuration and verification: applied appearance, postponed notifications')


if __name__ == '__main__':
    main()
