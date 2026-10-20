"""v3.4 offline Chromium: Vue application form, preview, XHR success/error."""
from pathlib import Path
import base64,re
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1]
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+rRNEAAAAASUVORK5CYII=')

def setup(browser,width):
    p=browser.new_page(viewport={'width':width,'height':830}); errors=[]
    p.on('pageerror',lambda e:errors.append(str(e)))
    html=(R/'upload.html').read_text();html=re.sub(r'<script\b[^>]*>\s*</script>','',html);html=re.sub(r'<link\b[^>]*>','',html)
    html=html.replace('</head>','<style>'+(R/'assets/core.css').read_text()+'\n'+(R/'assets/pages/upload.css').read_text()+'</style></head>')
    p.set_content(html)
    p.evaluate('''() => {
      const store={studentUser:JSON.stringify({name:'王同学',studentId:'00001'})};
      Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]}});
      window.__routePreflightPromise=null;window.CreditRouteGuard={destination:()=>null,localPath:p=>p};
      window.syncBus={on:()=>{},emit:(...args)=>window.__emit=args};
      window.apiCache={invalidate:p=>window.__invalidated=p};
      window.flashError=m=>window.__error=m;window.flashSuccess=m=>window.__success=m;
      window.__requests=[];
      window.XMLHttpRequest=class MockXHR{
        constructor(){this.upload={callbacks:{},addEventListener:(name,fn)=>this.upload.callbacks[name]=fn};window.__requests.push(this);this.status=200;this.responseText='{}';}
        open(method,url){this.method=method;this.url=url;}
        send(form){this.form=form;this.upload.callbacks.progress?.({lengthComputable:true,loaded:20,total:100});}
        finish(status=200,txt='{}'){this.status=status;this.responseText=txt;this.upload.callbacks.progress?.({lengthComputable:true,loaded:100,total:100});this.onload?.();}
        abort(){this.onabort?.();}
      };
    }''')
    p.add_script_tag(content=(R/'vendor/vue.global.js').read_text());p.add_script_tag(content=(R/'assets/theme.js').read_text())
    controller=(R/'assets/controllers/upload.mjs').read_text().replace('export function mount(vm) {','window.__testController = function mount(vm) {',1)
    p.add_script_tag(content=controller)
    app=(R/'assets/app.js').read_text().replace("const module = await import('/assets/controllers/' + page + '.mjs?v=3.4');","const module = { mount: vm => window.__testController(vm) };")
    assert 'window.__testController(vm)' in app
    p.add_script_tag(content=app)
    p.locator('#applyForm').wait_for(timeout=13000)
    return p,errors

def run():
  with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    for width in (320,390,768,1280):
      p,errs=setup(browser,width)
      assert p.locator('#name').input_value()=='王同学'
      assert p.locator('#studentId').input_value()=='00001'
      assert p.locator('#time').input_value().count('T') == 1
      p.locator('#activity').fill('校园科技活动');p.locator('#location').fill('科技楼');p.locator('#participants').fill('全班')
      p.get_by_role('button',name='提交申请',exact=True).click()
      p.wait_for_function("window.__error==='请至少上传一张证明图片！'")
      p.locator('#imageUpload').set_input_files({'name':'证明.png','mimeType':'image/png','buffer':PNG})
      p.locator('.preview-item').first.wait_for(timeout=15000)
      assert '1 / 2' in p.locator('#fileCount').inner_text()
      p.get_by_role('button',name='查看证明图片 1').click()
      assert p.get_by_role('dialog',name='查看证明图片').is_visible()
      p.get_by_role('button',name='关闭图片预览').click()
      assert p.get_by_role('dialog',name='查看证明图片').count()==0
      p.get_by_role('button',name='移除证明图片 1').click()
      assert p.locator('.preview-item').count()==0
      p.locator('#imageUpload').set_input_files({'name':'证明.png','mimeType':'image/png','buffer':PNG})
      p.locator('.preview-item').first.wait_for(timeout=15000)
      p.get_by_role('button',name='提交申请',exact=True).click()
      p.wait_for_function('window.__requests.length>0')
      assert p.get_by_role('button',name='提交中…').is_disabled()
      assert p.evaluate('window.__requests[0].url')=='/api/apps'
      assert p.evaluate('window.__requests[0].form.get("packageName")')=='00001'
      assert p.evaluate('window.__requests[0].form.get("versionName")')=='校园科技活动'
      assert p.evaluate('window.__requests[0].form.getAll("screenshots").length')==1
      assert p.get_by_role('progressbar',name='文件上传进度').is_visible()
      p.evaluate('window.__requests[0].finish(500,JSON.stringify({error:"网络稍后重试"}))')
      p.get_by_text('网络稍后重试').first.wait_for()
      assert not p.locator('.btn-submit').is_disabled()
      p.get_by_role('button',name='关闭并返回表单').click()
      assert p.locator('.application-progress-overlay').count()==0
      assert not errs,(width,errs)
      assert p.evaluate('document.documentElement.scrollWidth<=innerWidth+3'),width
      print('PASS Vue image selection, modal, remove, XHR failure and unlock',width)
      p.close()
    browser.close()

if __name__=='__main__': run()
