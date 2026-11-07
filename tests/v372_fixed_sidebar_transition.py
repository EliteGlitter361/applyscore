from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
css=(ROOT/"assets/core.css").read_text()
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path="/usr/bin/chromium",headless=True,args=["--no-sandbox","--disable-dev-shm-usage"])
    page=browser.new_page(viewport={"width":1280,"height":800})
    page.set_content('<style>'+css+'</style><div class="app-frame"><aside class="app-sidebar" style="position:fixed;left:0;top:0;width:248px;height:100vh;background:#eee">SIDEBAR</aside><main style="margin-left:248px;height:2400px">long page</main></div>')
    page.wait_for_timeout(450)
    before=page.locator(".app-sidebar").bounding_box()
    transform=page.locator(".app-frame").evaluate("(e)=>getComputedStyle(e).transform")
    page.evaluate("window.scrollTo(0,600)")
    page.wait_for_timeout(80)
    after=page.locator(".app-sidebar").bounding_box()
    assert before["y"]==0 and after["y"]==0,(before,after)
    assert transform=="none",transform
    page.evaluate("document.documentElement.classList.add('route-transition-leaving')")
    page.wait_for_timeout(60)
    after_leave=page.locator(".app-sidebar").bounding_box()
    assert after_leave["y"]==0,after_leave
    mobile=browser.new_page(viewport={"width":390,"height":844})
    mobile.set_content('<style>'+css+'</style><div class="app-frame"><aside class="app-sidebar" style="position:fixed;left:0;top:0;width:260px;height:100vh;background:#eee">SIDEBAR</aside><main style="height:2200px">long page</main></div>')
    mobile.wait_for_timeout(420)
    mobile.evaluate("window.scrollTo(0,500)")
    mobile.wait_for_timeout(60)
    assert mobile.locator(".app-sidebar").bounding_box()["y"]==0
    print("PASS fixed sidebar stays at viewport top while scrolling; transition transform is none; desktop/mobile")
    browser.close()
