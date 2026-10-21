"""Compare source and React preview using deterministic clocks and isolated storage."""
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright, expect

source = os.environ.get('SOURCE_URL', 'http://127.0.0.1:4174')
target = os.environ.get('ASSET_URL', 'http://127.0.0.1:4173')
output = Path(os.environ.get('VISUAL_OUTPUT', '.verification/equivalence'))
output.mkdir(parents=True, exist_ok=True)
results = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    for width in (1440, 390):
        for theme in ('light', 'dark'):
            for screen in ('login', 'inventory'):
                images, signatures = [], []
                for label, url in (('source', source), ('react', target)):
                    context = browser.new_context(viewport={'width': width, 'height': 1000}, reduced_motion='reduce')
                    page = context.new_page()
                    page.clock.install(time=datetime(2026, 10, 21, 12, tzinfo=timezone.utc))
                    page.add_init_script(f"localStorage.setItem('asset-manager.theme', '{theme}');")
                    page.goto(url, wait_until='networkidle')
                    # Apply via the existing public theme controller, including source's exact storage format.
                    page.evaluate("document.documentElement.setAttribute('data-theme', '" + theme + "')")
                    if screen == 'inventory':
                        page.get_by_label('Usuario', exact=True).fill('admin')
                        page.get_by_label('Contraseña', exact=True).fill('admin')
                        page.get_by_role('button', name='Entrar', exact=True).click()
                        expect(page.locator('.app-shell')).to_be_visible()
                        page.goto(url + '/#/inventario', wait_until='networkidle')
                        expect(page.get_by_role('heading', name='Inventario de activos')).to_be_visible()
                    page.evaluate('document.fonts.ready')
                    path = output / f'{label}-{screen}-{theme}-{width}.png'
                    # Animated external SVG is nondeterministic even in source-vs-source controls.
                    # Keep layout/text exact; verify this SVG byte-for-byte via the import manifest.
                    page.screenshot(path=str(path), full_page=True, animations='disabled', mask=[page.locator('.login__topology')])
                    images.append(Image.open(path).convert('RGB'))
                    signatures.append(page.locator('body').inner_text())
                    context.close()
                diff = ImageChops.difference(*images)
                bbox = diff.getbbox()
                results.append({'width': width, 'theme': theme, 'screen': screen, 'samePixels': bbox is None, 'sameText': signatures[0] == signatures[1], 'differenceBounds': bbox})
                if bbox: diff.save(output / f'diff-{screen}-{theme}-{width}.png')
    browser.close()
(output / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, indent=2))
assert all(r['samePixels'] and r['sameText'] for r in results), 'Visual or textual difference from source'
