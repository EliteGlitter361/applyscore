"""Check Vue file selection and remove action; leave upload transport compatibility intact."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
R=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 for width in (320,390,1280):
  page=browser.new_page(viewport={'width':width,'height':850});errors=[]
  page.on('pageerror',lambda err:errors.append(str(err)))
  html=(R/'file-upload.html').read_text();html=re.sub(r'<script\b[^>]*>\s*</script>','',html);html=re.sub(r'<link\b[^>]*>','',html)
  html=html.replace('</head>','<style>'+ (R/'assets/core.css').read_text()+'\n'+(R/'assets/pages/file-upload.css').read_text()+'</style></head>')
  page.set_content(html)
  page.evaluate('''() => {
    const store={};Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]}});
    window.CreditRouteGuard={destination:()=>null,localPath:p=>p};window.syncBus={on:()=>{},emit:()=>{}};
    window.apiCache={get:async()=>({allowMultipleFiles:true,maxFileSizeMB:20}),invalidate:()=>{}};
    window.__fileUploadSettings={allowMultipleFiles:true,maxFileSizeMB:20};window.__routePreflightPromise=null;
    window.flashSuccess=()=>{};window.flashError=()=>{};window.showAlert=()=>{};
  }''')
  page.add_script_tag(content=(R/'vendor/vue.global.js').read_text())
  page.add_script_tag(content=(R/'assets/theme.js').read_text())
  ctl=(R/'assets/controllers/file-upload.mjs').read_text().replace('export function mount(vm) {','window.__testController = function mount(vm) {')
  page.add_script_tag(content=ctl)
  app=(R/'assets/app.js').read_text().replace("const module = await import('/assets/controllers/' + page + '.mjs?v=3.4');", "const module = { mount: vm => window.__testController(vm) };")
  page.add_script_tag(content=app)
  page.locator('#fileInput').set_input_files([{'name':'实践报告.docx','mimeType':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','buffer':b'abc'},{'name':'summary.pdf','mimeType':'application/pdf','buffer':b'pdf'}])
  page.get_by_text('2 个文件').wait_for(timeout=10000)
  assert page.locator('#fileList .file-item').count()==2
  page.get_by_role('button',name='移除 实践报告.docx').click()
  page.get_by_text('1 个文件').wait_for(timeout=2000)
  assert page.locator('#fileList .file-item').count()==1
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
  assert not errors,(width,errors)
  print('PASS Vue selected file list',width)
  page.close()
 browser.close()
