
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
CSS=(ROOT/"assets/core.css").read_text()
GUARD=(ROOT/"assets/route-guard.js").read_text()
TARGET=(ROOT/"tests/fixtures/transition-b.html").as_uri()
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path="/usr/bin/chromium",headless=True,args=["--no-sandbox","--disable-dev-shm-usage","--allow-file-access-from-files"])
 p=b.new_page()
 p.set_content('<style>'+CSS+'</style><div class="app-frame" id="shell"><a id="next" href="'+TARGET+'">next</a></div>')
 print("url",p.url,"origin",p.evaluate("location.origin"),"target",TARGET)
 p.add_script_tag(content=GUARD)
 print("guard",p.evaluate("!!window.CreditRouteGuard"))
 print("anchor",p.locator("#next").evaluate("(a)=>({href:a.href,origin:new URL(a.href).origin})"))
 print("pre",p.evaluate("({cls:document.documentElement.className,pending:window.__routeNavigationPending})"))
 p.locator("#next").dispatch_event("click")
 print("after",p.evaluate("({cls:document.documentElement.className,pending:window.__routeNavigationPending,redirect:window.__routeRedirecting})"))
 b.close()
