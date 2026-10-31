"""Offline Chromium integration tests for Vue detail/editor and file-management list."""
from pathlib import Path
import re,json
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1]

def page_test(browser,view,width=390,mode='edit'):
 p=browser.new_page(viewport={'width':width,'height':800}); errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
 html=(R/(view+'.html')).read_text()
 html=re.sub(r'<script\b[^>]*>\s*</script>','',html);html=re.sub(r'<link\b[^>]*>','',html)
 css=(R/'assets/core.css').read_text()+'\n'+(R/f'assets/pages/{view}.css').read_text()
 html=html.replace('</head>','<style>'+css+'</style></head>')
 p.set_content(html)
 p.evaluate('''({view,mode})=>{
    const user=mode==='readonly'?{studentId:'99',name:'Guest'}:{studentId:'0001',name:'李同学'};
    const map={studentToken:'test-student',studentUser:JSON.stringify(user),adminToken:'test-system',adminUser:JSON.stringify({username:'system',role:'system'})};
    Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>map[k]||null,setItem:(k,v)=>map[k]=String(v),removeItem:k=>delete map[k]}});
    const OrigURLSearchParams=window.URLSearchParams;
    window.URLSearchParams=function(input){return new OrigURLSearchParams(input|| (view==='detail'?'?id=demo1':'?tab=files'));};
    window.__routePreflightPromise=null;
    window.CreditTheme={read:()=> 'light',useTheme:()=>Vue.ref('light'),toggle:()=>{}};
    window.CreditRouteGuard={destination:()=>null};
    window.syncBus={on:()=>{},emit:(...a)=>window.__emit=a};
    window.flashError=message=>window.__flashError=String(message);
    window.flashSuccess=message=>window.__flashSuccess=String(message);
    window.showConfirm=(title,message,yes,no,cb)=>{window.__confirmedTitle=title;cb(true)};
    window.__calls=[];
    const app={id:'demo1',name:'李同学',packageName:'0001',status:mode==='readonly'?'approved':'needs_fix',versionName:'课堂实践',publisher:'2026-10-19 14:30',participants:'全班',rejectReason:'请补充材料',screenshots:[]};
    window.apiCache={get:async(key,opts={})=>{
      if(key==='/api/apps')return [app];
      if(key==='/api/files')return [{id:'f1',name:'李同学',studentId:'0001',uploadedAt:'2026-10-19T14:30:00',files:['%E6%8A%A5%E5%91%8A.docx','附录.docx']}];
      if(key==='/api/admin/admins')return [];
      if(key==='/api/students')return [];
      return [];
    },invalidate:()=>{},invalidatePrefix:()=>{}};
    window.fetch=async(url,opts={})=>{
      window.__calls.push({url:String(url),method:opts.method||'GET',body:opts.body});
      if(opts.method==='DELETE')return {ok:true,json:async()=>({message:'ok'})};
      if(opts.method==='PUT')return {ok:true,json:async()=>({message:'ok'})};
      if(String(url)==='/api/files')return {ok:true,json:async()=>[]};
      if(String(url).startsWith('/api/'))return {ok:true,json:async()=>({students:[],admins:[],settings:{},entries:[]})};
      throw Error('unhandled fetch '+url);
    };
  }''',{'view':view,'mode':mode})
 p.add_script_tag(content=(R/'vendor/vue.global.js').read_text())
 # Need Vue before setting theme but CreditTheme.useTheme lazy.
 controller=(R/f'assets/controllers/{view}.mjs').read_text().replace('export function mount(vm) {','window.__testController = function mount(vm) {',1)
 p.add_script_tag(content=controller)
 appjs=(R/'assets/app.js').read_text().replace("const module = await import('/assets/controllers/' + page + '.mjs?v=3.4');","const module = { mount: vm => window.__testController(vm) };")
 assert 'const module = { mount:' in appjs
 p.add_script_tag(content=appjs)
 return p,errors

def run():
 with sync_playwright() as pw:
  br=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  for width in (320,390,768,1280):
   p,errs=page_test(br,'detail',width,'readonly')
   p.get_by_text('课堂实践',exact=True).wait_for(timeout=10000)
   assert '学号：0001' in p.locator('.detail-header').inner_text()
   assert p.locator('#editForm').count()==0
   assert not errs,(width,errs)
   print('PASS detail readonly',width);p.close()
  for width in (320,390,1280):
   p,errs=page_test(br,'detail',width,'edit')
   p.locator('#editVersionName').wait_for(timeout=10000)
   p.locator('#editVersionName').fill('更新活动')
   p.get_by_role('button',name='提交修改').click()
   p.wait_for_function('window.__calls.some(c=>c.method==="PUT")')
   assert p.evaluate('window.__calls.find(c=>c.method==="PUT").body.get("versionName")')=='更新活动'
   assert not errs,(width,errs)
   assert p.evaluate('document.documentElement.scrollWidth<=innerWidth+2'),width
   print('PASS detail edit',width);p.close()
  # cancelling mock redirects location, so defer DELETE never resolving, verify blocking modal + disabled actions.
  p,errs=page_test(br,'detail',390,'edit')
  p.locator('#btnCancelApp').wait_for(timeout=10000)
  p.evaluate('''()=>{const oldFetch=window.fetch;window.fetch=(url,opts)=>opts?.method==='DELETE'?new Promise(()=>{}):oldFetch(url,opts)}''')
  p.get_by_role('button',name='取消申请').click()
  p.get_by_role('alertdialog').wait_for(timeout=8000)
  assert p.locator('#btnCancelApp').is_disabled() and p.locator('#btnSubmitEdit').is_disabled()
  assert not errs,errs
  print('PASS detail cancel lock');p.close()
  # Server rejects cancel: Vue must close the blocker and enable both actions again.
  p,errs=page_test(br,'detail',390,'edit')
  p.locator('#btnCancelApp').wait_for(timeout=10000)
  p.evaluate('''()=>{const oldFetch=window.fetch;window.fetch=(url,opts)=>opts?.method==='DELETE'?Promise.resolve({ok:false,json:async()=>({error:'服务器暂不可用'})}):oldFetch(url,opts)}''')
  p.get_by_role('button',name='取消申请').click()
  p.wait_for_function('window.__flashError==="服务器暂不可用"')
  p.wait_for_function('document.querySelector("#btnCancelApp")?.disabled===false')
  assert p.locator('[role="alertdialog"]').count()==0
  assert not errs,errs
  print('PASS detail cancel failure restores controls');p.close()
  # Selected image becomes a Vue preview, can be removed before submitting.
  import base64
  p,errs=page_test(br,'detail',390,'edit')
  p.locator('#editScreenshots').wait_for(timeout=10000)
  image=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+rRNEAAAAASUVORK5CYII=')
  p.locator('#editScreenshots').set_input_files({'name':'test.png','mimeType':'image/png','buffer':image})
  p.locator('.preview-item').first.wait_for(timeout=10000)
  assert p.locator('.preview-item').count()==1
  p.locator('.remove-btn').click()
  assert p.locator('.preview-item').count()==0
  assert not errs,errs
  print('PASS detail Vue image previews');p.close()
  for width in (320,390,1280):
   p,errs=page_test(br,'admin',width,'edit')
   p.locator('#uploadTableBody tr').first.wait_for(timeout=12000)
   p.wait_for_function('document.querySelectorAll("#uploadTableBody tr").length===2')
   names=p.locator('#uploadTableBody .uploaded-file-name').all_text_contents()
   assert names==['报告.docx','附录.docx'],names
   paths=p.locator('#uploadTableBody .uploaded-file-action').first.get_attribute('href')
   assert '%25E6' not in paths and '%E6%8A%A5%E5%91%8A.docx' in paths, paths
   p.get_by_role('button',name='删除记录').first.click()
   p.wait_for_function('window.__calls.some(c=>c.method==="DELETE")')
   assert not errs,(width,errs)
   # only table region is allowed to overflow
   assert p.evaluate('document.documentElement.scrollWidth<=innerWidth+2')
   print('PASS admin files Vue',width)
   p.close()
  br.close()
if __name__=='__main__':run()
