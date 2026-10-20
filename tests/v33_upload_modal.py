"""v3.3: Vue upload form, countdown, XHR modal progress and close."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
R=Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 for width in (320,390,1280):
  p=browser.new_page(viewport={'width':width,'height':850});errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
  html=(R/'file-upload.html').read_text();html=re.sub(r'<script\b[^>]*>\s*</script>','',html);html=re.sub(r'<link\b[^>]*>','',html)
  html=html.replace('</head>','<style>'+(R/'assets/core.css').read_text()+'\n'+(R/'assets/pages/file-upload.css').read_text()+'</style></head>');p.set_content(html)
  p.evaluate('''() => {
    const store={studentUser:JSON.stringify({name:'王同学',studentId:'00001'})};
    Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]}});
    window.__routePreflightPromise=null;window.CreditRouteGuard={destination:()=>null,localPath:p=>p};window.syncBus={on:()=>{},emit:()=>{}};
    window.apiCache={get:async()=>({allowMultipleFiles:true,maxFileSizeMB:20}),invalidate:()=>{}};
    window.__fileUploadSettings={allowMultipleFiles:true,maxFileSizeMB:20,fileUploadDeadlineEnabled:true,fileUploadDeadline:Date.now()+7200000};
    window.flashSuccess=m=>window.__success=m;window.flashError=m=>window.__error=m;window.showAlert=(a,b,c,cb)=>{window.__alert=b;cb?.()};
    window.__requests=[];
    window.XMLHttpRequest=class MockXHR{
      constructor(){this.upload={callbacks:{},addEventListener:(name,fn)=>this.upload.callbacks[name]=fn};window.__requests.push(this);this.status=200;this.responseText='{}';}
      open(method,url){this.method=method;this.url=url;}
      send(form){this.form=form;this.upload.callbacks.progress?.({lengthComputable:true,loaded:20,total:100});}
      finish(){this.upload.callbacks.progress?.({lengthComputable:true,loaded:100,total:100});this.onload?.();}
      abort(){this.onabort?.();}
    };
  }''')
  p.add_script_tag(content=(R/'vendor/vue.global.js').read_text());p.add_script_tag(content=(R/'assets/theme.js').read_text())
  ctl=(R/'assets/controllers/file-upload.mjs').read_text().replace('export function mount(vm) {','window.__testController = function mount(vm) {',1)
  p.add_script_tag(content=ctl)
  app=(R/'assets/app.js').read_text().replace("const module = await import('/assets/controllers/' + page + '.mjs?v=3.4');","const module = { mount: vm => window.__testController(vm) };")
  assert 'window.__testController(vm)' in app
  p.add_script_tag(content=app)
  p.locator('#name').wait_for(timeout=12000)
  assert p.locator('#name').input_value()=='王同学'
  assert p.locator('#studentId').input_value()=='00001'
  p.get_by_text('距离上传截止还剩').wait_for()
  p.locator('#fileInput').set_input_files({'name':'paper.pdf','mimeType':'application/pdf','buffer':b'dummy'})
  p.get_by_text('1 个文件').wait_for()
  p.get_by_role('button',name='上传文件',exact=True).click()
  p.locator('#uploadModalOverlay').wait_for(state='visible')
  assert p.locator('#uploadModalOverlay .file-row').count()==1
  assert p.locator('#uploadProgressText').inner_text()=='20%'
  p.evaluate('window.__requests[0].finish()')
  p.locator('#uploadModalOverlay').wait_for(state='detached')
  assert not p.get_by_role('button',name='上传文件',exact=True).is_disabled()
  assert not errors,(width,errors)
  print('PASS Vue upload progress dialog',width)
  p.close()
 browser.close()
