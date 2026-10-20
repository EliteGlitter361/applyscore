"""v3.2 system management Vue regression. Offline Chromium + isolated API fixture."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
R=Path(__file__).resolve().parents[1]

def open_admin(browser,width=390, role='system'):
    page=browser.new_page(viewport={'width':width,'height':850})
    errors=[]
    page.set_default_timeout(3500)
    page.on('pageerror',lambda e: errors.append(str(e)))
    html=(R/'admin.html').read_text()
    html=re.sub(r'<script\b[^>]*>\s*</script>','',html)
    html=re.sub(r'<link\b[^>]*>','',html)
    css=(R/'assets/core.css').read_text()+'\n'+(R/'assets/pages/admin.css').read_text()
    html=html.replace('</head>','<style>'+css+'</style></head>')
    page.set_content(html)
    page.evaluate('''role=>{
      const storage={adminToken:'mock-token',adminUser:JSON.stringify({username:role,role}),aboutWriteToken:'mock-about-token'};
      Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>storage[k]||null,setItem:(k,v)=>storage[k]=String(v),removeItem:k=>delete storage[k]}});
      Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>null,setItem:()=>{},removeItem:()=>{}}});
      history.replaceState=()=>{};
      window.CreditRouteGuard={destination:()=>null,clearFileSettings:()=>{}};
      window.syncBus={on:()=>{},emit:()=>{}};
      window.CreditRefresh={run:(btn,callback)=>callback()};
      window.flashSuccess=m=>window.__success=String(m);window.flashError=m=>window.__error=String(m);
      window.showConfirm=(title,text,ok,cancel,fn)=>{window.__confirm={title,text};fn(true)};
      window.showPrompt=(title,text,current,prompt,ok,cancel,fn)=>fn('p789');
      window.withLoading=(btn,fn)=>fn();
      window.pulseElement=()=>{};
      const students=[{name:'李同学',studentId:'0001',password:'12345678',banned:false},{name:'赵同学',studentId:'0002',password:'',banned:true}];
      const adminList=[{id:1,username:role,role,auditPermission:1,canBan:true}];
      const uploads=[{id:'up1',name:'李同学',studentId:'0001',uploadedAt:Date.now(),files:[{name:'file1.docx'}]}];
      const logs=[{username:role,time:Date.now(),ip:'127.0.0.1',userAgent:'chromium-test'}];
      window.__test={students,uploads,logs,adminList,calls:[],fail:[],posted:[],note:''};
      window.apiCache={get:async url=>{
        if(url==='/api/admin')return adminList.map(x=>({...x}));
        if(url==='/api/students')return students.map(x=>({...x}));
        if(url==='/api/files')return uploads.map(x=>({...x}));
        if(url==='/api/settings')return {enabled:true,message:'',fileUploadEnabled:true,allowMultipleFiles:true};
        if(url.startsWith('/api/admin?action=login-logs'))return logs;
        if(url.startsWith('/api/maintenance?action=scan'))return {totalCount:4,count:2,sizeBytes:4096,apps:[{id:'app1',name:'张三',packageName:'001',versionName:'测试',status:'rejected',createdAt:Date.now()},{id:'app2',name:'李四',packageName:'002',versionName:'测试2',status:'cancelled',createdAt:Date.now()}]};
        throw Error('Unexpected cache '+url);
      },invalidate:()=>{},invalidatePrefix:()=>{},clear:()=>{}};
      window.fetch=async (url,opts={})=>{
        const body=opts.body?JSON.parse(opts.body):{};const method=opts.method||'GET';
        window.__test.calls.push({url:String(url),method,body});
        if(window.__test.fail.includes(String(url)))return {ok:false,status:500,json:async()=>({error:'模拟失败'})};
        if(url==='/api/settings'&&method==='POST')return {ok:true,status:200,json:async()=>({message:'保存成功'})};
        if(url==='/api/students'&&method==='PUT'){
          const row=students.find(x=>x.studentId===body.studentId);if(row)Object.assign(row,body);
          return {ok:true,status:200,json:async()=>({})};
        }
        if(url==='/api/students'&&method==='DELETE'){
          const index=students.findIndex(x=>x.studentId===body.studentId);if(index>=0)students.splice(index,1);
          return {ok:true,status:200,json:async()=>({})};
        }
        if(url==='/api/students'&&method==='POST'){students.push(body);return {ok:true,status:200,json:async()=>({})};}
        if(url==='/api/messages'&&method==='POST'){window.__test.posted.push(body);return {ok:true,status:200,json:async()=>({})};}
        if(url==='/api/maintenance?action=clean')return {ok:true,status:200,json:async()=>({message:'清理完成'})};
        throw Error('Unexpected fetch '+method+' '+url);
      };
      window.__routePreflightPromise=null;
    }''',role)
    page.add_script_tag(content=(R/'vendor/vue.global.js').read_text())
    page.add_script_tag(content=(R/'assets/theme.js').read_text())
    ctl=(R/'assets/controllers/admin.mjs').read_text().replace('export function mount(vm) {','window.__testController = function mount(vm) {',1)
    page.add_script_tag(content=ctl)
    app=(R/'assets/app.js').read_text().replace("const module = await import('/assets/controllers/' + page + '.mjs?v=3.4');","const module = { mount: (vm) => window.__testController(vm) };")
    assert 'window.__testController(vm)' in app
    page.add_script_tag(content=app)
    page.locator('#studentTableBody tr').first.wait_for(state='attached',timeout=15000)
    return page,errors

def run():
  with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    for width in (320,390,768,1280):
      p,errs=open_admin(browser,width)
      p.get_by_role('tab',name='学生管理',exact=True).first.click() if width>820 else p.locator('.admin-mobile-tab-select select').select_option('students')
      assert p.locator('#studentTableBody tr').count()==2
      assert p.locator('#studentTableBody').get_by_text('0001').is_visible()
      p.locator('#selectAllStudents').check()
      assert p.get_by_text('已选 2 人').first.is_visible()
      p.locator('#selectAllStudents').uncheck()
      p.locator('#studentTableBody tr').first.locator('input.student-checkbox').check()
      assert p.get_by_text('已选 1 人').first.is_visible()
      p.locator('#studentTableBody tr').first.get_by_role('button',name='封禁').click()
      p.wait_for_function("window.__test.students[0].banned===true")
      p.locator('#studentTableBody tr').first.get_by_text('已封禁').wait_for()
      select=lambda tab: p.locator('.admin-mobile-tab-select select').select_option(tab) if width<=820 else p.get_by_role('tab',name={'messages':'消息发送','logs':'登录日志','maintenance':'系统维护','tools':'工具','files':'文件管理'}[tab]).click()
      select('messages')
      p.locator('#msgStudentList').get_by_text('李同学').wait_for()
      p.get_by_role('button',name='全选',exact=True).click()
      assert p.get_by_text('已选 2 人').first.is_visible()
      p.locator('#msgTitle').fill('紧急通知');p.locator('#msgContent').fill('请尽快提交学分材料')
      p.get_by_role('button',name='发送消息').click()
      p.wait_for_function('window.__test.posted.length===2')
      p.get_by_text('发送完成：成功 2 条，失败 0 条').wait_for()
      assert not p.evaluate("!!document.querySelector('#msgStudentList [onchange]')")
      p.get_by_role('button',name='关闭',exact=True).last.click()
      select('logs')
      p.get_by_text('127.0.0.1').wait_for()
      select('maintenance')
      p.get_by_role('button',name='扫描冗余数据').click()
      p.get_by_text('4.00').wait_for()
      assert p.locator('#redundantTableBody tr').count()==2
      select('tools')
      p.locator('#entryMessage').fill('入口暂时关闭')
      p.locator('#toggleEntryBtn').click()
      p.get_by_role('button',name='保存设置',exact=True).click()
      p.wait_for_function("window.__test.calls.some(c=>c.url==='/api/settings' && c.body.message==='入口暂时关闭' && c.body.enabled===false)")
      p.locator('#requirementMessage').fill('请准备申请材料')
      p.locator('#toggleRequirementBtn').click()
      p.get_by_role('button',name='保存弹窗设置').click()
      p.wait_for_function("window.__test.calls.some(c=>c.url==='/api/settings' && c.body.uploadRequirementMessage==='请准备申请材料' && c.body.uploadRequirementEnabled===true)")
      p.locator('#announcementTitle').fill('教务通知')
      p.locator('#announcementMessage').fill('新版上线')
      p.locator('#toggleAnnouncementBtn').click()
      p.get_by_role('button',name='保存公告设置').click()
      p.wait_for_function("window.__test.calls.some(c=>c.url==='/api/settings' && c.body.announcementTitle==='教务通知' && c.body.announcementEnabled===true)")
      select('files')
      p.get_by_role('button',name='提交状态',exact=False).first.click()
      p.locator('#submissionModal').wait_for(state='visible')
      p.locator('#submissionModal').get_by_text('李同学').wait_for()
      assert p.locator('#submissionModal').get_by_text('已交 (1)').is_visible()
      p.locator('#submissionModal').get_by_role('button',name='未交 (1)').click()
      assert p.locator('#submissionTbody').get_by_text('赵同学').is_visible()
      p.locator('#submissionModal').get_by_role('button',name='×').click()
      assert p.locator('#submissionModal').count()==0
      assert p.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),f'overflow {width}'
      assert not errs,(width,errs)
      print('PASS v3.2 system Vue admin students/messages/logs/maintenance/submission',width)
      p.close()
    browser.close()
if __name__=='__main__':run()
