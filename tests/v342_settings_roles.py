"""Offline role behavior for Vue settings page, with same-origin music-host simulation."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/'settings.html').read_text()
html=re.sub(r'<script\b[^>]*src=[^>]*></script>','',html)
html=re.sub(r'<link\b[^>]*>','',html)
html=html.replace('</head>','<style>'+((ROOT/'assets/core.css').read_text()+'\n'+(ROOT/'assets/pages/settings.css').read_text())+'</style></head>')
vue=(ROOT/'vendor/vue.global.js').read_text()
app=(ROOT/'assets/app.js').read_text().replace("new URLSearchParams(location.search).get('view') === 'admin'", "true")
theme=(ROOT/'assets/theme.js').read_text()
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 for role in ('system','admin'):
  for width in (320,390,768,1280):
   page=browser.new_page(viewport={'width':width,'height':900})
   page.set_content(html)
   page.evaluate('''role => {
     const storage={adminToken:'test-role-token',adminUser:JSON.stringify({role,username:'test-admin'}),'credit:ui-theme:v1':'dark'};
     Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>storage[k]||null,setItem:(k,v)=>storage[k]=String(v),removeItem:k=>delete storage[k]}});
     window.__routePreflightPromise=null;
     window.CreditRouteGuard={destination:()=>null,localPath:p=>p};window.syncBus={on:()=>{}};
     window.__calls=[];
     window.CreditMusicHost={
       getSettings:()=>({enabled:true,autoPlay:false,showIsland:true,mode:'sequence',cacheCount:2}),
       updateSettings:s=>window.__calls.push(['update',s]),open:()=>window.__calls.push(['open']),
       clearCache:async()=>window.__calls.push(['clear'])
     };
     window.fetch=async (url,opt={})=>{window.__calls.push(['fetch',url,opt.method]); return {ok:true,status:200,json:async()=>({info:{title:'测试系统',description:'系统介绍',version:'3.4.2'},updatedAt:'2026-10-20'})};};
     window.flashError=()=>{};window.flashSuccess=()=>{};
   }''',role)
   page.add_script_tag(content=vue)
   page.add_script_tag(content=theme)
   page.add_script_tag(content=app)
   page.locator('.software-settings').wait_for(timeout=10000)
   # Admin and system use the *admin* sidebar, not the student one.
   assert page.locator('a.side-link[href="/settings.html?view=admin"]').count()==1
   assert page.locator('a.side-link[href="/dashboard.html"]').count()==1
   assert page.locator('.settings-about').count()==(1 if role=='system' else 0)
   assert page.evaluate("document.documentElement.dataset.theme")=='dark'
   assert page.evaluate("document.documentElement.scrollWidth")<=width+3
   page.locator('select.settings-select').select_option('shuffle')
   page.get_by_label('进入系统自动播放').check()
   page.get_by_role('button',name='打开音乐播放器').click()
   page.get_by_role('button',name='清理本机缓存').click()
   c=page.evaluate('window.__calls')
   assert any(x[0]=='update' and x[1].get('mode')=='shuffle' for x in c),c
   assert any(x[0]=='update' and x[1].get('autoPlay') is True for x in c),c
   assert ['open'] in c and ['clear'] in c,c
   if role=='system':
    page.locator('.settings-about input').first.fill('新系统名称')
    page.locator('.settings-about button[type=submit]').click()
    # No signed write token in fixture: Vue provides explicit feedback rather than pretending success.
    assert '重新登录' in page.locator('.settings-info-error').inner_text()
   print('PASS role and software controls',role,width)
   page.close()
 browser.close()
