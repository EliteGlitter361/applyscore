"""Offline Chromium Vue3 UI regression without network or local HTTP listeners."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
R=Path(__file__).resolve().parents[1]


if __name__=='__main__':
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  for width in (390,1280):
   p=browser.new_page(viewport={'width':width,'height':900});errs=[]
   p.on('pageerror',lambda e:errs.append(str(e)))
   html=(R/'index.html').read_text();html=re.sub(r'<script\b[^>]*>\s*</script>','',html);html=re.sub(r'<link\b[^>]*>','',html)
   html=html.replace('</head>','<style>'+(R/'assets/core.css').read_text()+'\n'+(R/'assets/pages/index.css').read_text()+'</style></head>')
   p.set_content(html)
   p.evaluate('''''''''() => {
    const saved={unused:'none'};
    Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>saved[k]||null,setItem:(k,v)=>saved[k]=String(v),removeItem:k=>delete saved[k]}});
    window.CreditRouteGuard={destination:()=>null,localPath:p=>p};window.syncBus={on:()=>{},emit:()=>{}};
    window.apiCache={get:async path=>path.startsWith('/api/apps')?[]:[],invalidate:()=>{},clear:()=>{}};
    window.fetch=async path=>({ok:true,json:async()=>String(path).includes('/api/requests')?[]:[]});
    window.flashSuccess=m=>window.__success=m;window.flashError=m=>window.__error=m;
    window.__routePreflightPromise=null;
   }''''''''' )
   p.add_script_tag(content=(R/'vendor/vue.global.js').read_text());p.add_script_tag(content=(R/'assets/theme.js').read_text())
   ctl=(R/'assets/controllers/index.mjs').read_text().replace('export function mount(vm) {','window.__testMountIndex = function mount(vm) {')
   p.add_script_tag(content=ctl)
   app=(R/'assets/app.js').read_text();app=re.sub(r"const module = await import\([^;]+\);", "const module = { mount: vm => window.__testMountIndex(vm) };",app)
   assert 'window.__testMountIndex(vm)' in app
   p.add_script_tag(content=app)
   p.locator('button[role=tab]').last.wait_for(timeout=10000)
   p.locator('button[role=tab]').last.click()
   p.wait_for_timeout(300)
   assert p.locator('button[role=tab]').last.get_attribute('aria-selected')=='true'
   assert p.locator('.assigned-tab-panel').is_visible()
   assert p.locator('.assigned-tab-panel .empty-state').count()==1
   assert '暂无内容' in p.locator('.assigned-tab-panel .empty-state').inner_text()
   assert not errs,errs
   print('PASS assigned tab click shows task list',width)
   p.close()
  browser.close()
