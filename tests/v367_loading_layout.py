from pathlib import Path
from playwright.sync_api import sync_playwright
import re
R=Path(__file__).resolve().parents[1]
css=(R/'assets/core.css').read_text()
guard=(R/'assets/route-guard.js').read_text()
html=(R/'messages.html').read_text()
overlay=re.search(r'<div id="credit-route-loading".*?</div>',html).group(0)
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    for width,height,theme in [(1440,900,'light'),(390,844,'light'),(390,844,'dark'),(768,1024,'dark')]:
        p=browser.new_page(viewport={'width':width,'height':height})
        p.set_content(f'<style>{css}</style><div id="app">content</div>{overlay}')
        p.evaluate('(t)=>document.documentElement.dataset.theme=t',theme)
        p.add_script_tag(content=guard)
        el=p.locator('#credit-route-loading')
        el.wait_for(state='visible')
        icon=p.locator('#credit-route-loading > img').bounding_box()
        text=p.locator('#credit-route-loading > span').bounding_box()
        bar=p.locator('#credit-route-loading .nbs-loading-line').bounding_box()
        assert icon and text and bar
        for b in (icon,text,bar):
            assert b['x']>=0 and b['x']+b['width']<=width+1,(width,theme,b)
        centers=[b['x']+b['width']/2 for b in (icon,text,bar)]
        assert max(centers)-min(centers)<1.5,(width,theme,centers)
        print("GEOM",width,height,theme,icon,text,bar)
        assert icon['y']<text['y']<bar['y'] and abs((icon['y']+bar['y']+bar['height'])/2-height/2)<100
        p.evaluate("document.dispatchEvent(new Event('viewready'))")
        p.wait_for_function("!document.documentElement.classList.contains('route-transition-loading')",timeout=2500)
        print('PASS',width,height,theme,'centred elements and release on ready')
        p.close()
    browser.close()
