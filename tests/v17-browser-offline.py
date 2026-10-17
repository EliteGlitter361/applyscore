"""Chromium about:blank offline test. The environment blocks navigation to local HTTP.
HTML, CSS and local Vue bundle are injected, with network requests mocked.
"""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
from PIL import Image
R=Path(__file__).resolve().parents[1]

def start(page,name,width=390,admin=False):
    html=(R/f'{name}.html').read_text()
    html=re.sub(r'<script\b[^>]*>\s*</script>', '', html)
    html=re.sub(r'<link\b[^>]*rel="stylesheet"[^>]*>', '', html)
    css='\n'.join((R/s).read_text() for s in ['assets/pages/'+name+'.css','assets/design.css','assets/mobile-v15.css'])
    html=html.replace('</head>','<style>'+css+'</style></head>')
    page.set_viewport_size({'width':width,'height':850})
    page.set_content(html,wait_until='domcontentloaded')
    page.evaluate('''(admin)=>{
        const vars=admin?{adminToken:'fake-jwt-system',adminUser:JSON.stringify({role:'system',username:'system'}),aboutWriteToken:'valid-signature'}:
            {studentToken:'student',studentUser:JSON.stringify({name:'小张',studentId:'2026001'})};
        Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>vars[k]||null,setItem(k,v){vars[k]=v},removeItem(k){delete vars[k]}}});
        window.__aboutWrites=[];
        window.fetch=async (url,opts={})=>{
          if(url==='/api/about'){
            if(opts.method==='PUT') {window.__aboutWrites.push(JSON.parse(opts.body));return {ok:true,json:async()=>({updatedAt:'2026-10-17T10:00:00Z'})};}
            return {ok:true,json:async()=>({info:{title:'学校学分系统',subtitle:'记录每一次成长',description:'第一行\\n第二行',version:'1.7',organization:'测试学校',website:'',contactEmail:''},updatedAt:null})};
          }
          throw new Error('unexpected fetch: '+url);
        };
        window.apiCache={clear(){},get:async()=>[],invalidate(){}};
        window.syncBus={on(){},emit(){}};
        window.flashError=message=>window.__flashError=message;
        window.flashSuccess=message=>window.__flashSuccess=message;
    }''',admin)
    page.add_script_tag(content=(R/'vendor/vue.global.js').read_text())
    app=(R/'assets/app.js').read_text()
    if name=='admin':
      app=app.replace("new URLSearchParams(window.location.search).get('tab')", "'about'")
      app=app.replace("await import('/assets/controllers/' + page + '.mjs?v=1.8')", "await Promise.resolve({mount:()=>{}})")
    if name=='upload':
      source=(R/'assets/controllers/upload.mjs').read_text().replace('export function mount()', 'window.__v17Mount = function mount()').replace("window.location.replace('/index.html')", "window.__v17Redirect='/index.html'")
      page.add_script_tag(content=source)
      app=app.replace("await import('/assets/controllers/' + page + '.mjs?v=1.8')", "await Promise.resolve({mount:()=>window.__v17Mount()})")
      page.evaluate('''()=>{
        window.__xhrCount=0;
        window.XMLHttpRequest=class {
          constructor(){window.__lastXHR=this;this.upload={events:{},addEventListener:(name,cb)=>{this.upload.events[name]=cb}};this.status=201;this.responseText='{}';}
          open(){}
          send(){window.__xhrCount++; setTimeout(()=>{this.upload.events.progress?.({lengthComputable:true,loaded:65,total:100})},100);}
        };
      }''')
    page.add_script_tag(content=app)

with sync_playwright() as playwright:
 browser=playwright.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 for width in [320,390,768,1280]:
  page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  start(page,'about',width)
  page.get_by_role('heading',name='学校学分系统').wait_for(timeout=6000)
  assert page.locator('a[href="/about.html"]').count()>=1
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),('overflow about',width)
  assert not errors,errors
  print('PASS About public Vue + mobile layout',width)
  page.close()
 page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 start(page,'admin',390,True)
 page.locator('#aboutTitle').wait_for(timeout=6000)
 assert page.locator('#aboutTitle').input_value()=='学校学分系统'
 page.locator('#aboutTitle').fill('新的关于标题')
 page.get_by_role('button',name='保存系统信息').click()
 page.wait_for_function("window.__aboutWrites.length === 1",timeout=6000)
 assert page.evaluate('window.__aboutWrites[0].title')=='新的关于标题'
 assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
 assert not errors,errors
 print('PASS system editor Vue submit + narrow viewport')
 page.close()
 page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 start(page,'upload',390)
 page.locator('#applyForm').wait_for(timeout=6000)
 page.locator('#activity').fill('模拟志愿活动')
 page.locator('#location').fill('教学楼')
 page.locator('#time').fill('2026-10-17T19:00')
 imgpath=R/'tests/.v17-sample.png'
 Image.new('RGB',(28,28),(120,140,220)).save(imgpath)
 page.locator('#imageUpload').set_input_files(str(imgpath))
 page.wait_for_function("document.querySelector('#fileCount').textContent.includes('1')",timeout=6000)
 page.locator('.btn-submit').click()
 page.locator('.application-progress-dialog').wait_for(timeout=6000)
 assert page.locator('.btn-submit').is_disabled()
 page.wait_for_function('window.__xhrCount===1',timeout=6000)
 page.get_by_text('文件上传 65%').wait_for(timeout=6000)
 page.evaluate("()=>{ window.__lastXHR.status=500; window.__lastXHR.responseText=JSON.stringify({error:'服务器拒绝'});window.__lastXHR.onload() }")
 page.get_by_text('提交未成功').wait_for(timeout=6000)
 assert page.get_by_text('服务器拒绝').is_visible()
 page.get_by_role('button',name='关闭并返回表单').click()
 assert page.locator('.btn-submit').is_enabled()
 page.locator('.btn-submit').click()
 page.wait_for_function('window.__xhrCount===2',timeout=6000)
 page.evaluate("()=>{window.__lastXHR.status=201; window.__lastXHR.onload()}")
 page.get_by_text('申请已提交').wait_for(timeout=6000)
 assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
 assert not errors,errors
 print('PASS upload modal progress, server error recovery, retry and confirmed success')
 imgpath.unlink(missing_ok=True)
 page.close()
 browser.close()
