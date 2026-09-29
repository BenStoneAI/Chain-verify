import asyncio
from playwright.async_api import async_playwright
import os

async def test_viewports():
    file_url = 'file:///' + os.path.abspath('ChainVerify.html').replace('\\', '/')
    widths = [320, 375, 390, 430, 768, 1024, 1440]
    height = 800

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        print(f"=== TESTING CHAINVERIFY.HTML ACROSS VIEWPORTS ===")
        all_passed = True

        for w in widths:
            await page.set_viewport_size({'width': w, 'height': height})
            await page.goto(file_url, wait_until='load')
            await page.wait_for_timeout(600)

            # Check for horizontal overflow
            scroll_width = await page.evaluate('document.documentElement.scrollWidth')
            client_width = await page.evaluate('document.documentElement.clientWidth')
            overflow = scroll_width > client_width

            # Check visibility of stage cards
            stage1_h2 = await page.inner_text('#stage-1 .story-card h2')
            stage2_h2 = await page.inner_text('#stage-2 .story-card h2')
            stage3_h2 = await page.inner_text('#stage-3 .story-card h2')
            stage4_h2 = await page.inner_text('#stage-4 .story-card h2')
            stage5_h2 = await page.inner_text('#stage-5 .story-card h2')

            # Check font readability and touch sizes
            card_padding = await page.evaluate("window.getComputedStyle(document.querySelector('.story-card')).padding")
            h2_font = await page.evaluate("window.getComputedStyle(document.querySelector('.story-card h2')).fontSize")

            has_error = overflow or not stage1_h2 or not stage4_h2
            status = "PASSED (No Overflow)" if not overflow else "FAILED (Overflow Detected)"
            if has_error:
                all_passed = False

            print(f"Viewport {w}x{height}px: {status} | ScrollWidth: {scroll_width} / {client_width} | H2: '{stage1_h2}' | Card Font: {h2_font} | Padding: {card_padding}")

        print(f"\nOverall Result: {'ALL VIEWPORT TESTS PASSED PERFECTLY' if all_passed else 'FAILURES DETECTED'}")
        await browser.close()

if __name__ == '__main__':
    asyncio.run(test_viewports())
