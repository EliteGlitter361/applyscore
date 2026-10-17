"""Offline Chromium simulation for v1.8 (no external network, no real Gitee writes)."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
R=Path(__file__).resolve().parents[1]
html=(R/'admin.html').read_text()
html=re.sub(r'<script\b[^>]*>\s*</script>','',html)
html=re.sub(r'<link\b[^>]*rel="stylesheet"[^>]*>','',html)
css='\n'.join((R/k).read_text() for k in ['assets/pages/admin.css','assets/design.css','assets/mobile-fixes.css','assets/mobile-v15.css'])
html=html.replace('</head>','<style>'+css+'</style></head>')
source=(R/'assets/controllers/admin.mjs').read_text().replace('export function mount()', 'window.__adminMount = function mount()')
app=(R/'assets/app.js').read_text().replace("history.replaceState(history.state, '', tab === 'admins' ? '/admin.html' : '/admin.html?tab=' + tab);",'void 0;').replace("await import('/assets/controllers/' + page + '.mjs?v=1.8')", "await Promise.resolve({mount:()=>window.__adminMount()})")

with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':390,'height':850})
 errs=[]
 page.on('pageerror',lambda e:errs.append(str(e)))
 page.on('console',lambda m:print('BROWSER',m.type,m.text[:300]) if m.type in ('error','warning') else None)
 page.set_content(html,wait_until='domcontentloaded')
 page.evaluate('''() => {
   const vars={adminToken:'dummy',adminUser:JSON.stringify({username:'system',role:'system'}),aboutWriteToken:'token'};
   Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>vars[k]??null,setItem(k,v){vars[k]=v},removeItem(k){delete vars[k]}}});
   window.__students=[{name:'甲',studentId:'1001'},{name:'乙',studentId:1002}];
   window.__uploads=[{id:'u1',name:'甲',studentId:'1001',files:['1_a.pdf','2_b.png'],uploadedAt:Date.now()}];
   window.__apiCalls=[];window.__fetchCalls=[];window.__progressEvents=[];
   window.apiCache={get:async (url,opts={})=>{window.__apiCalls.push(url);if(url==='/api/students')return window.__students;if(url==='/api/files') {await new Promise(r=>setTimeout(r,180));return window.__uploads;} if(url==='/api/admin')return [];if(url==='/api/settings')return {};return [];},invalidate(){},clear(){},invalidatePrefix(){}};
   window.syncBus={on(){},emit(){}};
   window.flashSuccess = ()=>{};window.flashError = (s)=>window.__errorText=s;
   window.showConfirm=(...args)=>args.at(-1)(true);
   window.withLoading=async(_,fn)=>fn();
   window.__sent=[];
   window.fetch=async (u,opt={})=>{
     window.__fetchCalls.push(String(u));
     if(String(u).includes('/api/uploads/')) {window.__parallel=(window.__parallel||0)+1;window.__maxParallel=Math.max(window.__parallel,window.__maxParallel||0);await new Promise(r=>setTimeout(r,65));window.__parallel--;return {ok:true,arrayBuffer:async()=>new TextEncoder().encode('data').buffer};}
     if(String(u)==='/api/messages'){window.__sent.push(JSON.parse(opt.body));await new Promise(r=>setTimeout(r,80));return {ok:true,status:201,json:async()=>({})};}
     if(String(u)==='/api/about'){await new Promise(r=>setTimeout(r,160));return {ok:true,json:async()=>({updatedAt:Date.now(),info:{title:'测试'}})};}
     return {ok:true,json:async()=>({})};
   };
   let oldCreate=URL.createObjectURL; URL.createObjectURL=b=>{window.__savedZip=b;return 'blob:testing';};URL.revokeObjectURL=()=>{};
   HTMLAnchorElement.prototype.click=function(){if(this.download) window.__downloadName=this.download;};
 }''')
 page.add_script_tag(content=(R/'vendor/vue.global.js').read_text())
 page.add_script_tag(content=(R/'vendor/jszip.min.js').read_text())
 page.add_script_tag(content=source)
 page.add_script_tag(content=app)
 page.wait_for_function('window.__appReady===true',timeout=5000)
 # Message progress: exactly one request per selected student; sequential Gitee writes.
 page.locator('select[aria-label="选择系统管理选项卡"]').select_option('messages')
 
 page.wait_for_function("document.querySelectorAll('#msgStudentList input[type=checkbox]').length===2",timeout=5000)
 page.locator('#msgTitle').fill('通知')
 page.locator('#msgContent').fill('请查看说明')
 page.get_by_role('button',name='全选').click()
 page.locator('#tab-messages button',has_text='发送消息').click()
 page.locator('.admin-progress-dialog').wait_for(timeout=5000)
 assert page.get_by_text('正在发送消息…').is_visible()
 page.wait_for_function('window.__sent.length===2',timeout=5000)
 page.get_by_role('heading',name='消息发送完成').wait_for(timeout=5000)
 assert page.locator('.admin-progress-percent').inner_text()=='100%'
 assert page.evaluate('window.__sent.length')==2
 page.get_by_role('button',name='关闭',exact=True).last.click()
 print('PASS messages: modal + counted progress + success')
 # Status first paint, then data; repeat open shows snapshot without network await.
 page.locator('select[aria-label="选择系统管理选项卡"]').select_option('files')
 page.wait_for_function("document.querySelector('#uploadTableBody').textContent.includes('甲')",timeout=5000)
 page.get_by_role('button',name='提交状态').click()
 page.locator('#submissionModal.show').wait_for(timeout=3000)
 page.wait_for_function("document.querySelector('#submissionTbody').textContent.includes('甲')",timeout=5000)
 page.locator('#submissionModal .modal-close').click()
 status=page.evaluate('''()=>{window.openSubmissionModal();return {visible:document.querySelector('#submissionModal').classList.contains('show'),text:document.querySelector('#submissionTbody').textContent}}''')
 assert status['visible'] and '甲' in status['text'],status
 page.locator('#submissionModal .modal-close').click()
 print('PASS status: immediate cached rows + background refresh')
 # ZIP progress and actual data blob
 page.get_by_role('button',name='打包下载全部').click()
 page.get_by_text('正在并发下载文件…').wait_for(timeout=5000)
 page.get_by_role('heading',name='打包下载已开始').wait_for(timeout=15000)
 assert page.evaluate('window.__savedZip instanceof Blob')
 assert page.evaluate('''async()=>{const z=await JSZip.loadAsync(window.__savedZip);return Object.keys(z.files).filter(x=>!z.files[x].dir).length===2}''')
 assert page.evaluate('window.__downloadName.startsWith("uploads_")')
 assert page.evaluate('window.__maxParallel <= 5')
 page.get_by_role('button',name='关闭',exact=True).last.click()
 print('PASS zip: parallel fetch + generated Blob + progress completion')
 # system info indeterminate progress until PUT resolves
 page.locator('select[aria-label="选择系统管理选项卡"]').select_option('about')
 page.locator('#aboutTitle').wait_for(timeout=5000)
 page.locator('#aboutTitle').fill('新版系统')
 page.locator('#tab-about button[type=submit]').click()
 page.get_by_text('正在保存系统信息…').wait_for(timeout=3000)
 assert page.locator('.admin-progress-fill.is-indeterminate').count()==1
 page.get_by_role('heading',name='系统信息保存成功').wait_for(timeout=5000)
 assert page.locator('.admin-progress-dialog').is_visible()
 assert not errs,errs
 assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
 print('PASS about: indeterminate save + confirmation + mobile width')
 page.get_by_role('button',name='关闭',exact=True).last.click()
 page.evaluate("window.fetch=(u,opts={})=>{if(u==='/api/about' && opts.method==='PUT')return Promise.resolve({ok:false,json:async()=>({error:'Gitee 拒绝写入'})});return Promise.resolve({ok:true,json:async()=>({info:{title:'测试'},updatedAt:null})})}")
 page.locator('#aboutTitle').fill('失败场景')
 page.locator('#tab-about button[type=submit]').click()
 page.get_by_role('heading',name='系统信息保存失败').wait_for(timeout=5000)
 assert page.locator('.admin-progress-close').is_visible()
 print('PASS about: failed save surfaces error and unlocks form')
 browser.close()
