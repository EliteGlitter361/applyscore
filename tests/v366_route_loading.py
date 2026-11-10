# Compatibility regression for the DOM loading surface introduced in v3.6.7.
from pathlib import Path
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1]
css=(R/'assets/core.css').read_text()
js=(R/'assets/route-guard.js').read_text()
loader='<div id="credit-route-loading"><div class="credit-loading-stack"><img class="credit-loading-icon"><span class="credit-loading-label">正在打开页面…</span><span class="credit-loading-progress"></span></div></div>'
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    for page_name in ('messages','index'):
        p=browser.new_page()
        p.set_content(f'<style>{css}</style>{loader}<div id="app"></div>')
        if page_name=='index':p.evaluate("document.documentElement.dataset.page='index';document.documentElement.dataset.announcementState='checking'")
        p.add_script_tag(content=js)
        assert p.locator('#credit-route-loading').is_visible()
        p.evaluate("document.dispatchEvent(new Event('viewready'))")
        if page_name=='index':
            assert p.locator('#credit-route-loading').is_visible()
            p.evaluate("document.documentElement.dataset.announcementState='ready';window.dispatchEvent(new Event('credit-announcement-ready'))")
        p.wait_for_function("!document.documentElement.classList.contains('route-transition-loading')",timeout=2500)
        p.close()
    print('PASS direct entry and announcement readiness overlay')
    browser.close()
