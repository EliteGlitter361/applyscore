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
      const adminList=[{id:1,username:role,role,auditPermission:1,canBan:true}];const tasks=[{id:'r1',title:'运动会',studentIds:['0001'],submissions:[{studentId:'0001',name:'李同学',activityName:'运动会',location:'操场',activityTime:'2026-11-01T08:00',files:[{originalName:'照片.png'}]}]}, {id:'r2',title:'艺术节',studentIds:['0002'],submissions:[]}];
      const uploads=[{id:'up1',name:'李同学',studentId:'0001',uploadedAt:Date.now(),files:[{name:'file1.docx'}]}];
      const logs=[{username:role,time:Date.now(),ip:'127.0.0.1',userAgent:'chromium-test'}];
      window.__test={students,uploads,logs,adminList,tasks,calls:[],fail:[],posted:[],note:''};
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
        if(url==='/api/requests'&&method==='GET')return {ok:true,status:200,json:async()=>tasks};
        if(url==='/api/requests'&&method==='POST'){tasks.push({id:'r-new',title:body.title,studentIds:body.studentIds,submissions:[]});return {ok:true,status:201,json:async()=>({message:'申请已发送'})};}
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
    app=(R/'assets/app.js').read_text().replace("const module = await import('/assets/controllers/' + page + '.mjs?v=3.6.6');","const module = { mount: (vm) => window.__testController(vm) };")
    assert 'window.__testController(vm)' in app
    page.add_script_tag(content=app)
    page.locator('#studentTableBody tr').first.wait_for(state='attached',timeout=15000)
    return page,errors


if __name__=='__main__':
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  for width in [390,1280]:
   p,err=open_admin(browser,width)
   select=lambda tab:(p.locator('.admin-mobile-tab-select select').select_option(tab) if width<=820 else p.locator('button[data-tab="'+tab+'"]').click())
   select('requests')
   p.locator('#tab-requests tbody tr').first.wait_for()
   assert p.locator('#tab-requests tbody').get_by_text('李同学').count()>0
   assert p.locator('#tab-requests tbody tr').count()==3, p.locator('#tab-requests tbody').inner_text()
   assert not err, err
   p.locator('#tab-requests input[placeholder="请输入活动名称"]').fill('活动三')
   p.locator('.request-student-option input').first.check()
   p.locator('#tab-requests button').get_by_text('发送申请',exact=True).click()
   p.wait_for_function('window.__test.tasks.length===3')
   p.locator('#tab-requests tbody').get_by_text('活动三').wait_for()
   assert not err,err
   select('files')
   p.locator('#uploadTableBody tr input[type=checkbox]').first.check()
   assert p.get_by_role('button',name='批量删除（1）').count()==1
   select('requests')
   assert not err,err
   print('PASS admin render + tab transitions + create targeted request + file select width',width)
   p.close()
  browser.close()
