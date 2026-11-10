from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
CSS=(ROOT/"assets/core.css").read_text()
GUARD=(ROOT/"assets/route-guard.js").read_text()
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path="/usr/bin/chromium",headless=True,args=["--no-sandbox","--disable-dev-shm-usage"])
    page=browser.new_page(viewport={"width":1280,"height":800},reduced_motion="no-preference")
    page.set_content('<style>'+CSS+'</style><div class="app-frame" id="shell"><main class="page-view">page</main></div>')
    page.add_script_tag(content=GUARD)
    initial=page.locator("#shell").evaluate("(e)=>getComputedStyle(e).animationName")
    assert initial=="creditPageEnter",initial
    page.evaluate("window.CreditRouteGuard.navigateAway('/next.html',false)")
    page.wait_for_function("document.documentElement.classList.contains('route-transition-leaving')")
    leaving=page.locator("#shell").evaluate("(e)=>getComputedStyle(e).animationName")
    assert leaving=="creditPageLeave",leaving
    assert page.evaluate("window.__routeNavigationPending===true")
    page.evaluate("clearTimeout(window.__routeNavigationTimer)")
    page.close()

    back=browser.new_page(reduced_motion="no-preference")
    back.set_content('<style>'+CSS+'</style><div class="app-frame" id="shell">page</div>')
    back.add_script_tag(content=GUARD)
    back.evaluate("""()=>{const e=new Event('pageshow');Object.defineProperty(e,'persisted',{value:true});window.dispatchEvent(e)}""")
    back_anim=back.locator("#shell").evaluate("(e)=>getComputedStyle(e).animationName")
    assert back_anim=="creditPageEnter",back_anim
    back.close()

    reduced=browser.new_page(reduced_motion="reduce")
    reduced.set_content('<style>'+CSS+'</style><div class="app-frame" id="shell">page</div>')
    reduced.add_script_tag(content=GUARD)
    anim=reduced.locator("#shell").evaluate("(e)=>getComputedStyle(e).animationName")
    assert anim=="none",anim
    reduced.close()
    print("PASS: app entrance, navigation exit animation, Back/Forward re-entry animation, reduced-motion")
    browser.close()
