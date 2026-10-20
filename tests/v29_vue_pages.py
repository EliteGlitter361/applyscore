"""Offline Chromium behavior regression: Vue messages & student management."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
R=Path(__file__).resolve().parents[1]

def open_page(browser,view,width):
 page=browser.new_page(viewport={'width':width,'height':820}); errs=[]
 page.on('pageerror',lambda e:errs.append(str(e)))
 html=(R/(view+'.html')).read_text()
 html=re.sub(r'<script\b[^>]*>\s*</script>','',html)
 html=re.sub(r'<link\b[^>]*>','',html)
 css=(R/'assets/core.css').read_text()+'\n'+(R/f'assets/pages/{view}.css').read_text()
 html=html.replace('</head>','<style>'+css+'</style></head>')
 page.set_content(html)
 page.evaluate('''view => {
  const storage={studentToken:'student-jwt-20260001',studentUser:JSON.stringify({studentId:'20260001',name:'王同学'}),adminToken:'fake-jwt-admin',adminUser:JSON.stringify({username:'admin',role:'admin'})};
  Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>storage[k]||null,setItem:(k,v)=>storage[k]=String(v),removeItem:k=>delete storage[k]}});
  window.CreditRouteGuard={destination:()=>null,localPath:p=>p,clearFileSettings:()=>{}};
  window.syncBus={on:()=>{},emit:()=>{}};
  window.flashSuccess=m=>window.__success=m; window.flashError=m=>window.__error=m;
  window.showAlert=(title,text)=>window.__alert={title,text};
  window.showConfirm=(title,text,ok,cancel,callback)=>{window.__confirm={title,text}; callback(true);};
  window.apiCache={get:async()=>window.__mockMessages.map(x=>({...x})),invalidatePrefix:()=>{},clear:()=>{}};
  window.__mockMessages=[{id:'one',title:'审核结果',content:'材料已通过',type:'approved',read:false,createdAt:Date.now()},
      {id:'two',title:'通知',content:'请补充资料',type:'needs_fix',read:false,createdAt:Date.now()-7200000}];
  window.__mockStudents=[{name:'李同学',studentId:'0001'},{name:'赵同学',studentId:'0002'}];
  window.__calls=[];
  window.fetch=async(url,opts={})=>{
    window.__calls.push({url:String(url),method:opts.method||'GET',body:opts.body});
    const action=String(url);
    if(action==='/api/students' && !opts.method) return {ok:true,json:async()=>window.__mockStudents.map(s=>({...s}))};
    if(action==='/api/students' && opts.method==='POST'){
      const s=JSON.parse(opts.body);window.__mockStudents.push(s);return {ok:true,json:async()=>({message:'ok'})};
    }
    if(action==='/api/students' && opts.method==='DELETE'){
      const s=JSON.parse(opts.body);window.__mockStudents=window.__mockStudents.filter(x=>x.studentId!==s.studentId);return {ok:true,json:async()=>({message:'ok'})};
    }
    if(action.startsWith('/api/messages')) return {ok:true,json:async()=>({message:'ok'})};
    throw new Error('Unexpected API '+action);
  };
  window.XLSX={read:()=>({SheetNames:['Sheet1'],Sheets:{Sheet1:{}}}),utils:{sheet_to_json:()=>[{姓名:'钱同学',学号:'0003'}]}};
  window.__routePreflightPromise=null;
 }''',view)
 page.add_script_tag(content=(R/'vendor/vue.global.js').read_text())
 page.add_script_tag(content=(R/'assets/theme.js').read_text())
 controller=(R/f'assets/controllers/{view}.mjs').read_text().replace('export function mount(vm) {','window.__testController = function mount(vm) {')
 page.add_script_tag(content=controller)
 app=(R/'assets/app.js').read_text().replace("const module = await import('/assets/controllers/' + page + '.mjs?v=3.4');", "const module = { mount: (vm) => window.__testController(vm) };")
 assert 'const module = { mount:' in app
 page.add_script_tag(content=app)
 return page,errs

def run():
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  for width in (320,390,768,1280):
   page,errs=open_page(browser,'messages',width)
   page.locator('.msg-item').first.wait_for(timeout=15000)
   assert page.locator('.msg-item').count()==2
   page.locator('.msg-item').first.click()
   assert page.get_by_role('dialog',name='审核结果').is_visible()
   page.keyboard.press('Escape')
   assert page.get_by_role('dialog').count()==0
   page.get_by_role('button',name='全部已读').click()
   page.wait_for_function("document.querySelectorAll('.msg-item.read').length===2")
   assert page.evaluate("window.__calls.some(c=>c.url.includes('mark-all-read'))")
   assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
   assert not errs,(width,errs)
   print('PASS messages Vue',width)
   page.close()
  for width in (320,390,768,1280):
   page,errs=open_page(browser,'student',width)
   page.locator('tbody tr').first.wait_for(timeout=15000)
   assert page.locator('tbody tr').count()==2
   page.get_by_label('全选学生').check()
   assert page.locator('input.student-checkbox:checked').count()==2
   page.get_by_role('button',name='删除选中（2）').click()
   page.wait_for_function('document.querySelectorAll("tbody tr").length===0')
   page.locator('#newName').fill('李四')
   page.locator('#newStudentId').fill('0009')
   page.get_by_role('button',name='添加学生').click()
   page.get_by_text('0009').wait_for(timeout=4000)
   # Batch-import uses XLSX adapter but the progress itself is reactive Vue state.
   page.locator('#fileInput').set_input_files({'name':'student.xlsx','mimeType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','buffer':b'test'})
   page.get_by_role('button',name='导入',exact=True).click()
   page.get_by_text('导入完成：成功 1 条，失败 0 条').wait_for(timeout=10000)
   assert page.locator('tbody tr').count()==2
   assert page.locator('.import-progress').get_attribute('aria-valuenow')=='100'
   assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
   assert not errs,(width,errs)
   print('PASS students Vue',width)
   page.close()
  browser.close()
if __name__=='__main__':run()
