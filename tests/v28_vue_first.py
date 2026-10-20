"""Offline Chromium Vue3 UI regression without network or local HTTP listeners."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
R=Path(__file__).resolve().parents[1]

def run():
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  for width in (320,390,768,1280):
   page=browser.new_page(viewport={'width':width,'height':900})
   js_errors=[]
   page.on('pageerror',lambda err:js_errors.append(str(err)))
   html=(R/'index.html').read_text()
   html=re.sub(r'<script\b[^>]*>\s*</script>','',html)
   html=re.sub(r'<link\b[^>]*>','',html)
   css=(R/'assets/pages/index.css').read_text()+'\n'+(R/'assets/core.css').read_text()
   html=html.replace('</head>','<style>'+css+'</style></head>')
   page.set_content(html)
   page.evaluate('''() => {
    const saved={};Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>saved[k]||null,setItem:(k,v)=>{saved[k]=String(v)},removeItem:k=>{delete saved[k]}}});
    window.CreditRouteGuard={destination:()=>null,localPath:p=>p};
    window.syncBus={on:()=>{},emit:()=>{}};
    window.apiCache={get:async path=>path.startsWith('/api/apps') ? [
      {id:'a',status:'approved',name:'张同学',packageName:'20260001',versionName:'汉字活动甲',publisher:'2026-10-20'},
      {id:'b',status:'needs_fix',name:'张同学',packageName:'20260001',versionName:'英语展示',publisher:'2026-10-19',rejectReason:'请补充证明'},
      {id:'c',status:'approved',name:'李同学',packageName:'20260002',versionName:'校园服务',publisher:'2026-10-18'}
    ]:[],invalidate:()=>{},clear:()=>{}};
    window.flashSuccess=()=>{};window.flashError=()=>{};
    window.__routePreflightPromise=null;
  }''')
   page.add_script_tag(content=(R/'vendor/vue.global.js').read_text())
   page.add_script_tag(content=(R/'assets/theme.js').read_text())
   page.add_script_tag(content=(R/'assets/vue-feedback.js').read_text())
   page.add_script_tag(content=(R/'custom-dialog.js').read_text())
   code=(R/'assets/controllers/index.mjs').read_text().replace('export function mount(vm) {','window.__testMountIndex = function mount(vm) {')
   page.add_script_tag(content=code)
   app=(R/'assets/app.js').read_text().replace("const module = await import('/assets/controllers/' + page + '.mjs?v=3.4');","const module = { mount: (vm) => window.__testMountIndex(vm) };")
   page.add_script_tag(content=app)
   page.get_by_text('汉字活动甲').wait_for(timeout=15000)
   assert page.locator('.app-card').count()==2,(width,'wrong card count')
   assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'),(width,'overflow in index')
   page.get_by_placeholder('搜索姓名、学号或活动名称...').fill('校园服务')
   page.wait_for_timeout(400)
   assert page.locator('.app-card').count()==1,(width,'search filter')
   page.get_by_placeholder('搜索姓名、学号或活动名称...').fill('')
   page.wait_for_timeout(350)
   page.get_by_role('tab',name='需要修改的学分').click()
   assert page.get_by_text('您还未登录').is_visible()
   page.get_by_role('tab',name='待发放的学分').click()
   page.evaluate("CreditTheme.set('dark')")
   page.wait_for_timeout(250)
   assert page.locator('.app-card').count()==2
   assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'),(width,'dark overflow')
   page.evaluate("() => {showConfirm('删除确认','确认删除这个记录吗？','确定','取消',v=>window.__testChoice=v)}")
   page.get_by_role('dialog',name='删除确认').wait_for(timeout=3000)
   page.get_by_role('dialog').get_by_role('button',name='取消').click()
   assert page.evaluate('window.__testChoice') is False
   page.evaluate("() => {showPrompt('输入测试','填写编号','', '学号','提交','返回',v=>window.__testValue=v)}")
   page.get_by_role('dialog',name='输入测试').locator('input').fill('20260001')
   page.get_by_role('dialog').get_by_role('button',name='提交').click()
   assert page.evaluate('window.__testValue')=='20260001'
   page.evaluate("flashSuccess('已保存')")
   page.get_by_text('已保存').wait_for()
   page.evaluate("showLoadingOverlay('正在处理…')")
   page.locator('.credit-vue-busy-card').wait_for()
   page.evaluate('hideLoadingOverlay()')
   page.locator('.credit-vue-busy-card').wait_for(state='detached')
   assert not js_errors,(width,js_errors)
   print('PASS Vue3 home, filters, tabs, modal, theme and no overflow',width)
   page.close()
  browser.close()
if __name__=='__main__':run()
