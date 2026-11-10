from pathlib import Path
from playwright.sync_api import sync_playwright
import re
R=Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 for width in (390,1280):
  p=b.new_page(viewport={'width':width,'height':850});errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
  html=(R/'index.html').read_text();html=re.sub(r'<link\b[^>]*>','',html)
  html=html.replace('</head>','<style>'+(R/'assets/core.css').read_text()+'\n'+(R/'assets/pages/index.css').read_text()+'</style></head>')
  p.set_content(html)
  p.evaluate('''() => { const x={};Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>x[k]||null,setItem:(k,v)=>x[k]=String(v),removeItem:k=>delete x[k]}});window.CreditRouteGuard={destination:()=>null,localPath:x=>x};window.syncBus={on:()=>{},emit:()=>{}};window.apiCache={get:async()=>[],invalidate:()=>{},clear:()=>{}};window.fetch=async()=>({ok:true,json:async()=>[]});window.__routePreflightPromise=null; }''')
  p.add_script_tag(content=(R/'vendor/vue.global.js').read_text())
  p.add_script_tag(content=(R/'assets/theme.js').read_text())
  ctl=(R/'assets/controllers/index.mjs').read_text().replace('export function mount(vm) {','window.__testMountIndex = function mount(vm) {');p.add_script_tag(content=ctl)
  app=(R/'assets/app.js').read_text();app=re.sub(r'const module = await import\([^;]+\);','const module = { mount: vm => window.__testMountIndex(vm) };',app);p.add_script_tag(content=app)
  search=p.locator('.search-bar input[type=search]');search.wait_for(timeout=10000)
  p.get_by_role('tab',name='管理员发放的申请').click()
  assert search.is_visible(), 'search vanished'
  assert p.locator('.assigned-tab-panel').is_visible()
  assert p.get_by_text('暂无内容',exact=True).is_visible()
  assert '管理员' in search.get_attribute('placeholder')
  search.fill('不匹配的关键字');p.wait_for_timeout(350)
  assert p.get_by_text('没有匹配的申请',exact=True).is_visible()
  p.get_by_role('tab',name='待发放的学分').click()
  assert search.is_visible()
  assert not errors,errors
  print('PASS',width,'search visible and usable across tabs')
  p.close()
 b.close()
