"""Vue 3 dashboard regression — mocked API in offline Chromium, no live data writes."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
R=Path(__file__).resolve().parents[1]

def open_dashboard(browser,role='admin',audit=True,ban=True,width=390):
  p=browser.new_page(viewport={'width':width,'height':850});errors=[]
  p.on('pageerror',lambda e:errors.append(str(e)))
  html=(R/'dashboard.html').read_text()
  html=re.sub(r'<script\b[^>]*>\s*</script>','',html)
  html=re.sub(r'<link\b[^>]*>','',html)
  css=(R/'assets/core.css').read_text()+'\n'+(R/'assets/pages/dashboard.css').read_text()
  html=html.replace('</head>','<style>'+css+'</style></head>')
  p.set_content(html)
  p.evaluate('''params => {
    const records=[
      {id:'p1',status:'pending',name:'学生甲',packageName:'0001',versionName:'志愿活动A',publisher:'2026-10-20 12:00',participants:'全班',screenshots:[]},
      {id:'p2',status:'pending',name:'学生乙',packageName:'0002',versionName:'实践活动B',publisher:'2026-10-20 13:00',screenshots:[]},
      {id:'a1',status:'approved',name:'学生丙',packageName:'0003',versionName:'已审核A',publisher:'2026-10-19',screenshots:[]},
      {id:'a2',status:'approved',name:'学生丁',packageName:'0004',versionName:'已审核B',publisher:'2026-10-18',screenshots:[]}
    ];
    const students=[{name:'学生甲',studentId:'0001',banned:false},{name:'学生乙',studentId:'0002',banned:true}];
    const storage={adminToken:'fake-jwt-'+params.role,adminUser:JSON.stringify({username:params.role,role:params.role})};
    Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>storage[k]||null,setItem:(k,v)=>storage[k]=String(v),removeItem:k=>delete storage[k]}});
    window.__mock={records,students,calls:[],events:[],fail:false};
    window.CreditRouteGuard={destination:()=>null};
    window.syncBus={on:()=>()=>{},emit:(key,data)=>window.__mock.events.push({key,data})};
    window.flashError=m=>window.__lastError=String(m);window.flashSuccess=m=>window.__lastSuccess=String(m);
    window.apiCache={get:async key=>{
      if(key.includes('my-permissions'))return {auditPermission:params.audit,canBan:params.ban};
      if(key==='/api/apps')return records.map(a=>({...a}));
      if(key==='/api/students')return students.map(s=>({...s}));
      throw Error('unexpected API cache '+key);
    },invalidate:()=>{},clear:()=>{}};
    window.fetch=async (url,opts={})=>{
      const method=opts.method||'GET';const body=opts.body?JSON.parse(opts.body):{};
      window.__mock.calls.push({url:String(url),method,body});
      if(window.__mock.fail && method!=='GET')return {ok:false,status:500,json:async()=>({error:'模拟写入失败'})};
      if(url==='/api/audit'&&method==='PUT'){
        const a=records.find(a=>a.id===body.id);
        if(!a)return{ok:false,json:async()=>({error:'未找到'})};
        if(body.action==='approve')a.status='approved';
        else if(body.action==='needs_fix'){a.status='needs_fix';a.rejectReason=body.rejectReason;}
        else if(body.action==='reject')records.splice(records.indexOf(a),1);
      } else if(url==='/api/apps'&&method==='DELETE'){
        for(const id of body.ids){const idx=records.findIndex(a=>a.id===id);if(idx!==-1)records.splice(idx,1);}
      }else if(url==='/api/students'&&method==='PUT'){
        const a=students.find(s=>s.studentId===body.studentId);if(a)a.banned=body.banned;
      }else throw Error('Unexpected API '+method+' '+url);
      return{ok:true,status:200,json:async()=>({message:'ok'})};
    };
  }''',{'role':role,'audit':audit,'ban':ban})
  p.add_script_tag(content=(R/'vendor/vue.global.js').read_text())
  p.add_script_tag(content=(R/'assets/theme.js').read_text())
  controller=(R/'assets/controllers/dashboard.mjs').read_text().replace('export function mount(vm) {','window.__testController = function mount(vm) {',1)
  p.add_script_tag(content=controller)
  app=(R/'assets/app.js').read_text().replace("const module = await import('/assets/controllers/' + page + '.mjs?v=3.4');", "const module = { mount: (vm) => window.__testController(vm) };")
  assert 'window.__testController(vm)' in app
  p.add_script_tag(content=app)
  p.get_by_text('志愿活动A').wait_for(timeout=10000)
  return p,errors

def run():
 with sync_playwright() as pw:
  b=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
  for width in (320,390,768,1280):
   p,errors=open_dashboard(b,width=width)
   assert p.locator('section[aria-label="待审核申请"] .dashboard-app-card').count()==2
   p.get_by_role('button',name='志愿活动A').click()
   dialog=p.get_by_role('dialog',name='志愿活动A')
   dialog.wait_for()
   dialog.get_by_role('button',name='通过',exact=True).click()
   p.wait_for_function("window.__mock.records.find(a=>a.id==='p1').status==='approved'")
   p.get_by_role('tab',name='已审核',exact=False).click()
   assert p.locator('section[aria-label="已审核申请"] .dashboard-app-card').count()==3
   p.locator('.dashboard-approved-check input[type="checkbox"]').first.check()
   p.get_by_role('button',name='删除选中（1）').click()
   p.get_by_role('dialog',name='确认删除').get_by_role('button',name='确认删除').click()
   p.wait_for_function('window.__mock.records.length===3')
   p.get_by_role('tab',name='待审核',exact=False).click()
   p.locator('section[aria-label="待审核申请"] .dashboard-app-card').first.click()
   p.get_by_role('dialog').get_by_role('button',name='驳回修改').click()
   p.get_by_role('dialog',name='驳回修改').get_by_placeholder('请详细说明原因').fill('请补材料')
   p.get_by_role('dialog',name='驳回修改').get_by_role('button',name='确定').click()
   p.wait_for_function("window.__mock.records.find(a=>a.id==='p2').status==='needs_fix'")
   assert p.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'),(width,'overflow')
   assert not errors,(width,errors)
   print('PASS Vue approval / batch deletion / needs-fix',width)
   p.close()
  p,errors=open_dashboard(b,role='admin',width=390)
  p.get_by_role('tab',name='封禁管理').click()
  p.get_by_role('button',name='封禁',exact=True).click()
  p.get_by_role('dialog',name='确认封禁').get_by_role('button',name='确认').click()
  p.wait_for_function('window.__mock.students[0].banned===true')
  assert not errors,errors
  print('PASS admin ban/unban');p.close()
  p,errors=open_dashboard(b,role='system',width=390)
  assert p.get_by_role('tab',name='封禁管理').count()==0
  assert p.get_by_role('button',name='退出登录').count()==0
  print('PASS system permission separation');p.close()
  p,errors=open_dashboard(b,role='admin',audit=False,ban=False)
  p.locator('.dashboard-app-card').first.click()
  assert p.get_by_text('您没有审核权限').is_visible()
  assert p.get_by_role('dialog').get_by_role('button',name='通过',exact=True).count()==0
  assert p.get_by_role('tab',name='封禁管理').count()==0
  print('PASS read-only permission');p.close()
  p,errors=open_dashboard(b)
  p.evaluate('window.__mock.fail=true')
  p.locator('.dashboard-app-card').first.click()
  p.get_by_role('dialog').get_by_role('button',name='通过',exact=True).click()
  p.get_by_text('模拟写入失败').first.wait_for(timeout=5000)
  assert p.evaluate("window.__mock.records.find(a=>a.id==='p1').status")=='pending'
  print('PASS failed review retains source records');p.close()
  p,errors=open_dashboard(b,width=390)
  p.locator('.dashboard-search-wrap input').fill('0002')
  assert p.locator('section[aria-label="待审核申请"] .dashboard-app-card').count()==1
  p.locator('.dashboard-search-wrap input').fill('')
  p.locator('section[aria-label="待审核申请"] .dashboard-app-card').first.click()
  p.get_by_role('dialog',name='志愿活动A').get_by_role('button',name='不通过',exact=True).click()
  reason=p.get_by_role('dialog',name='不通过并删除')
  reason.get_by_placeholder('请详细说明原因').fill('审核不符合条件')
  reason.get_by_role('button',name='确定',exact=True).click()
  assert p.get_by_text('最终确认：此操作将永久删除申请，无法恢复。').is_visible()
  reason.get_by_role('button',name='确认永久删除').click()
  p.wait_for_function("window.__mock.records.every(a=>a.id!=='p1')")
  assert p.evaluate("window.__mock.calls.some(c=>c.url==='/api/audit' && c.body.action==='reject' && c.body.rejectReason==='审核不符合条件')")
  assert not errors,errors
  print('PASS reject two-step confirmation and Vue search');p.close()
  b.close()
if __name__=='__main__':run()
