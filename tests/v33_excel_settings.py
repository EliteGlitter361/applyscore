"""v3.3: system upload-settings Vue state and spreadsheet import, isolated Chromium."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
R=Path(__file__).resolve().parents[1]
def init(browser,width=390):
 p=browser.new_page(viewport={'width':width,'height':850});p.set_default_timeout(6500);errors=[]
 p.on('pageerror',lambda e:errors.append(str(e)))
 html=(R/'admin.html').read_text();html=re.sub(r'<script\b[^>]*>\s*</script>','',html);html=re.sub(r'<link\b[^>]*>','',html)
 html=html.replace('</head>','<style>'+(R/'assets/core.css').read_text()+'\n'+(R/'assets/pages/admin.css').read_text()+'</style></head>')
 p.set_content(html)
 p.evaluate('''() => {
  const store={adminToken:'t',adminUser:JSON.stringify({role:'system',username:'system'})};
  Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]}});
  window.__routePreflightPromise=null;window.CreditRouteGuard={destination:()=>null,clearFileSettings:()=>{}};
  history.replaceState=()=>{};window.syncBus={on:()=>{},emit:()=>{}};window.CreditRefresh={run:(b,f)=>f()};
  window.flashSuccess=m=>window.__success=String(m);window.flashError=m=>window.__error=String(m);
  window.showConfirm=(t,m,y,n,fn)=>fn(true);window.showPrompt=(t,m,v,o,y,n,fn)=>fn('new');
  window.withLoading=(b,fn)=>fn();window.pulseElement=()=>{};
  window.apiCache={get:async url=>{
    if(url==='/api/settings')return {enabled:true,fileUploadEnabled:true,allowMultipleFiles:true,maxSubmissionsPerStudent:3,maxFileSizeMB:50,fileUploadDeadlineEnabled:false};
    if(url==='/api/admin')return [];if(url==='/api/students')return window.__students.map(x=>({...x}));
    if(url==='/api/files')return [];throw Error('unmocked '+url);
  },invalidate:()=>{},invalidatePrefix:()=>{},clear:()=>{}};
  window.__students=[];window.__calls=[];window.__failed=[];
  window.fetch=async(url,options={})=>{
    const body=options.body?JSON.parse(options.body):null;
    window.__calls.push({url:String(url),body,method:options.method||'GET'});
    if(window.__failed.includes(String(url)))return {ok:false,status:500,json:async()=>({error:'模拟网络失败'})};
    if(url==='/api/students'&&options.method==='POST'){window.__students.push(body);return {ok:true,status:200,json:async()=>({})};}
    if(url==='/api/settings'&&options.method==='POST')return {ok:true,status:200,json:async()=>({})};
    throw Error('unmocked fetch '+url);
  };
 }''')
 p.add_script_tag(content=(R/'vendor/vue.global.js').read_text());p.add_script_tag(content=(R/'assets/theme.js').read_text())
 ctl=(R/'assets/controllers/admin.mjs').read_text().replace('export function mount(vm) {','window.__testController = function mount(vm) {',1)
 p.add_script_tag(content=ctl)
 app=(R/'assets/app.js').read_text().replace("const module = await import('/assets/controllers/' + page + '.mjs?v=3.4');","const module = { mount: vm => window.__testController(vm) };")
 assert 'window.__testController(vm)' in app
 p.add_script_tag(content=app)
 p.locator('#studentTableBody').wait_for(state='attached',timeout=15000)
 return p,errors
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 for width in (320,390,768,1280):
  p,errs=init(browser,width)
  select=lambda tab:p.locator('.admin-mobile-tab-select select').select_option(tab) if width<=820 else p.get_by_role('tab',name={'students':'学生管理','tools':'工具'}[tab]).click()
  select('tools')
  p.locator('#maxSubmissions').wait_for()
  assert p.locator('#maxSubmissions').input_value()=='3'
  assert p.locator('input[name=fileSizeMode][value="50"]').is_checked()
  p.locator('input[name=fileSizeMode][value="custom"]').check()
  p.locator('#customFileSize').fill('70')
  assert '70MB' in p.locator('#fileSizePreview').inner_text()
  p.locator('#maxSubmissions').fill('4')
  p.locator('input[name=deadlineMode][value=duration]').check()
  p.locator('#deadlineHours').fill('2')
  p.locator('#deadlineMinutes').fill('15')
  p.get_by_role('button',name='保存文件上传设置').click()
  p.wait_for_function('window.__calls.some(c=>c.url==="/api/settings"&&c.body.maxFileSizeMB===70&&c.body.maxSubmissionsPerStudent===4&&c.body.fileUploadDeadlineEnabled===true&&c.body.fileUploadDeadline>Date.now())')
  p.locator('input[name=deadlineMode][value=none]').check()
  p.get_by_role('button',name='保存文件上传设置').click()
  p.wait_for_function('window.__calls.some(c=>c.url==="/api/settings"&&c.body.fileUploadDeadlineEnabled===false&&c.body.fileUploadDeadline===null)')
  select('students')
  p.evaluate('''() => {window.XLSX={read:()=>({SheetNames:['One'],Sheets:{One:{}}}),utils:{sheet_to_json:()=>[{姓名:'阿明',学号:'000045',密码:'p1'},{姓名:'阿红',学号:'00123',密码:''}]}}}''')
  p.locator('#fileInput').set_input_files({'name':'学生名单.xlsx','mimeType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','buffer':b'123'})
  p.get_by_role('button',name='导入',exact=True).click()
  p.get_by_text('导入完成：成功 2 条，失败 0 条').wait_for(timeout=10000)
  assert p.locator('#importProgress').get_attribute('aria-valuenow')=='100'
  assert p.evaluate('window.__students.map(x=>x.studentId).join(",")')=='000045,00123'
  assert not errs,(width,errs)
  print('PASS Vue system settings and XLSX import',width)
  p.close()
 browser.close()
