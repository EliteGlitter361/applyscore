"""Offline Chromium: early theme paint, about logo, loading states, drawer animation."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json, re, base64
ROOT = Path(__file__).resolve().parents[1]
about= (ROOT/'about.html').read_text()
assert 'class="about-brand-glyph"><img src="/assets/icons/网页选项卡标题，网站logo.webp"' in about
critical=re.search(r'<style id="credit-critical-paint">.*?</style>',about).group(0)
theme=(ROOT/'assets/theme.js').read_text()
logo=base64.b64encode((ROOT/'assets/icons/网页选项卡标题，网站logo.webp').read_bytes()).decode()
style=(ROOT/'assets/core.css').read_text()+'\n'+(ROOT/'assets/pages/about.css').read_text()
# Standalone theme JS runs synchronously, before ANY late stylesheet or Vue code.
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 boot=browser.new_page()
 boot.set_content('''<html><head><script>const storage={'credit:ui-theme:v1':'dark'};Object.defineProperty(window,'localStorage',{value:{getItem:k=>storage[k]||null,setItem:(k,v)=>storage[k]=v}});</script><script>'''+theme+'</script>'+critical+'</head><body><div id="app">正在加载</div></body></html>')
 colors=boot.evaluate('''() => [document.documentElement.dataset.theme,getComputedStyle(document.documentElement).backgroundColor,getComputedStyle(document.body).backgroundColor,getComputedStyle(document.getElementById('app')).backgroundColor]''')
 assert colors==['dark','rgb(16, 25, 39)','rgb(16, 25, 39)','rgb(16, 25, 39)'], colors
 print('PASS synchronous dark prepaint without core CSS / Vue')
 for path in ROOT.glob('*.html'):
  text=path.read_text()
  assert text.index('credit-critical-paint')<text.index('rel="stylesheet"'),path
 print('PASS early prepaint in all 15 HTML entry points')
 boot.set_content('<html data-theme="dark"><head><style>'+style+'</style></head><body><div class="first-paint"><span>正在加载</span><span class="first-paint-bar"></span></div><div class="skeleton skeleton-card"></div><div class="route-checking">检查中</div><div class="preflight-error">失败后重试</div></body></html>')
 cols=boot.evaluate("() => ['body','.first-paint','.skeleton','.route-checking','.preflight-error'].map(x=>getComputedStyle(document.querySelector(x)).backgroundColor)")
 assert all(x!='rgb(255, 255, 255)' for x in cols), cols
 print('PASS dark skeleton, loading, preflight colors',cols)
 boot.close()
 # Test actual Vue About page with loaded supplied icon, offline mocks, and responsive drawer.
 for width in (320,390,768,1280):
  page=browser.new_page(viewport={'width':width,'height':850})
  raw=re.sub(r'<script\b[^>]*src=[^>]*></script>','',about)
  raw=re.sub(r'<link\b[^>]*>','',raw)
  raw=raw.replace('/assets/icons/网页选项卡标题，网站logo.webp','data:image/webp;base64,'+logo)
  raw=raw.replace('</head>','<style>'+style+'</style></head>')
  page.set_content(raw)
  page.evaluate('''() => {const storage={'credit:ui-theme:v1':'dark'};Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>storage[k]||null,setItem:(k,v)=>storage[k]=v,removeItem:k=>delete storage[k]}});window.CreditRouteGuard={destination:()=>null,localPath:p=>p};window.syncBus={on:()=>{},emit:()=>{}};window.__routePreflightPromise=null;window.flashError=()=>{};window.fetch=async()=>({ok:true,json:async()=>({info:{title:'学分申请系统',subtitle:'测试',description:'说明',organization:'测试组织',version:'3.4'},updatedAt:'2026-10-20'})});}''')
  page.add_script_tag(content=(ROOT/'vendor/vue.global.js').read_text())
  page.add_script_tag(content=theme)
  page.add_script_tag(content=(ROOT/'assets/app.js').read_text())
  page.locator('.about-brand-glyph img').wait_for(timeout=15000)
  page.wait_for_timeout(440)
  result=page.evaluate('''() => {const c=x=>getComputedStyle(document.querySelector(x));const img=document.querySelector('.about-brand-glyph img');return {theme:document.documentElement.dataset.theme,background:c('body').backgroundColor,icon:img.complete&&img.naturalWidth>0,about:c('.about-public-card').backgroundColor,sidebar:c('.app-sidebar').backgroundColor,scroll:document.documentElement.scrollWidth}}''')
  assert result['theme']=='dark',result
  assert result['background']=='rgb(16, 25, 39)',result
  assert result['icon'],result
  assert result['about'] != 'rgb(255, 255, 255)',result
  assert result['sidebar'] != 'rgb(255, 255, 255)',result
  assert result['scroll']<=width+3,(width,result)
  if width<=820:
   page.locator('.menu-trigger').click()
   page.wait_for_timeout(460)
   left=page.evaluate("() => document.querySelector('.app-sidebar').getBoundingClientRect().x")
   assert abs(left)<2,(width,left)
   page.locator('.nav-shade').click(position={'x':width-4,'y':240})
   page.wait_for_timeout(460)
   right=page.evaluate("() => document.querySelector('.app-sidebar').getBoundingClientRect().right")
   assert right<4,(width,right)
  print('PASS About Vue, dark theme and responsive nav',width)
  page.close()
 browser.close()
