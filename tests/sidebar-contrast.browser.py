"""Rendered contrast of sidebar labels and badges in every shipped preset/theme."""
import io
import os
import re
from PIL import Image
from playwright.sync_api import expect, sync_playwright

USERNAME = os.environ['ITSM_TEST_USERNAME']
PASSWORD = os.environ['ITSM_TEST_PASSWORD']

BASE = os.environ.get('ASSET_URL', 'http://127.0.0.1:5173')


def luminance(channels):
    linear = [v / 255 / 12.92 if v / 255 <= .04045 else ((v / 255 + .055) / 1.055) ** 2.4 for v in channels]
    return sum(v * weight for v, weight in zip(linear, (.2126, .7152, .0722)))


def painted_contrast(element):
    # Sample the painted background, including color-mix and inherited chrome.
    foreground = element.evaluate('el => getComputedStyle(el).color')
    channels = [float(v) for v in re.findall(r'[\d.]+', foreground)][:3]
    assert foreground.startswith('rgb'), foreground
    previous = element.get_attribute('style')
    element.evaluate("el => el.style.setProperty('color', 'transparent', 'important')")
    try:
        image = Image.open(io.BytesIO(element.screenshot(animations='disabled'))).convert('RGB')
        background = image.getpixel((image.width // 2, image.height // 2))
    finally:
        element.evaluate('(el, value) => value === null ? el.removeAttribute("style") : el.setAttribute("style", value)', previous)
    first, second = sorted((luminance(channels), luminance(background)))
    return (second + .05) / (first + .05)


failures = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    for theme in ('light', 'dark'):
        for preset in ('generic', 'forest', 'blue'):
            context = browser.new_context(viewport={'width': 1440, 'height': 1000}, color_scheme=theme, reduced_motion='reduce')
            page = context.new_page()
            page.set_default_timeout(5000)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(BASE, wait_until='networkidle')
            page.get_by_label('Usuario', exact=True).fill(USERNAME)
            page.get_by_label('Contraseña', exact=True).fill(PASSWORD)
            page.get_by_role('button', name='Entrar', exact=True).click()
            expect(page.locator('.app-shell')).to_be_visible()
            if preset != 'generic':
                page.goto(BASE + '/#/configuracion/apariencia', wait_until='networkidle')
                page.locator('[data-od-id="appearance-preset-' + preset + '"]').click()
                page.locator('[data-od-id="appearance-apply"]').click()
                expect(page.locator('.appearance-feedback')).to_contain_text('Identidad aplicada')
            page.goto(BASE + '/#/panel', wait_until='networkidle')
            expect(page).to_have_url(re.compile(r'/#/panel$'))
            assert page.locator('html').get_attribute('data-theme') == theme
            labels = page.locator('.sidebar__label')
            badges = page.locator('.sidebar .nav-link__count--alert')
            assert labels.count() >= 2
            assert sorted(badges.all_text_contents()) == ['3', '9']
            for kind, collection in (('label', labels), ('badge', badges)):
                for element in collection.all():
                    expect(element).to_be_visible()
                    value = painted_contrast(element)
                    print(f'{theme}/{preset} {kind} {element.inner_text()!r}: {value:.2f}:1')
                    if value < 4.5:
                        failures.append(f'{theme}/{preset} {kind}: {value:.2f}:1 < 4.5:1')
            assert not errors, errors
            assert page.evaluate('location.hash') == '#/panel'
            context.close()
    browser.close()
assert not failures, '\n'.join(failures)
print('PASS sidebar labels and enabled alert badge contrast across six preset/theme combinations; counts and routes unchanged')
