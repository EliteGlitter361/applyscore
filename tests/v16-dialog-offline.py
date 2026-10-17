"""Offline Chromium smoke tests for the system setup CTA and cancellation UI.
No external network and no Cloudflare credentials. Uses about:blank with locally
loaded JS and mocked API responses to exercise real rendering/DOM interactions.
"""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]

def load_html(page, name, css_files=[]):
    html=(ROOT/(name+'.html')).read_text()
    html=re.sub(r'<script\b[^>]*>\s*</script>', '', html)
    html=re.sub(r'<link\b[^>]*rel="stylesheet"[^>]*>', '', html)
    css='\n'.join((ROOT/part).read_text() for part in css_files)
    html=html.replace('</head>', '<style>'+css+'</style></head>')
    page.set_content(html,wait_until='domcontentloaded')

def setup_page(page,exists):
    load_html(page,'login',['assets/pages/login.css','assets/design.css','assets/mobile-v15.css','assets/initialization-v16.css'])
    page.evaluate('''(exists)=>{
      window.__initFetchCount=0;
      window.fetch=async (url)=> { if(String(url).includes('/api/admin/check-system')){
         window.__initFetchCount++;
         return exists===null ? {ok:false,status:503,json:async()=>({error:'模拟故障'})}
           : {ok:true,status:200,json:async()=>({exists})};
      } throw new Error('unexpected fetch '+url); };
      Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:()=>null,setItem(){},removeItem(){}}});
      window.apiCache={};
    }''',exists)
    page.add_script_tag(content=(ROOT/'vendor/vue.global.js').read_text())
    page.add_script_tag(content=(ROOT/'assets/app.js').read_text())


def detail_page(page):
    # controller compatibility HTML is rendered into #detailContent by mount()
    page.set_content('<html><head><style>'+ (ROOT/'assets/pages/detail.css').read_text()+'</style></head><body><div id="app"><main id="detailContent"></main></div></body></html>')
    page.evaluate('''()=>{
      const user={studentId:'20260001',name:'测试用户'};
      Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem(k){return k==='studentToken'?'token':k==='studentUser'?JSON.stringify(user):null}}});
      window.apiCache={get:async()=>[{id:'app-001',versionName:'测试学分申请',publisher:'2026-10-17 12:00',participants:'测试',packageName:'20260001',name:'测试用户',screenshots:[],status:'needs_fix'}], invalidatePrefix() {}};
      window.syncBus={emit(){window.__emitted=true},on(){}};
      window.flashError=(msg)=>{window.__error=msg};
      window.flashSuccess=(msg)=>{window.__success=msg};
      window.showConfirm=(title,msg,confirm,cancel,callback)=>{window.__confirmCancel=callback};
      window.withLoading=async (btn,task)=>task();
      window.__deleteCount=0;
      window.fetch=(url,opts)=>{
        if(opts && opts.method==='DELETE'){
           window.__deleteCount++;
           return new Promise((resolve,reject)=>{window.__resolveDelete=(ok,message)=>resolve({ok,json:async()=>({error:message||'模拟失败'})});window.__rejectDelete=reject;});
        }
        if(opts && opts.method==='PUT'){
           return new Promise(resolve=>{window.__resolvePut=(ok)=>resolve({ok,json:async()=>({error:'模拟修改失败'})});});
        }
        return Promise.reject(new Error('unexpected fetch'));
      };
      window.history.replaceState({},'', 'about:blank?id=app-001');
    }''')
    controller=(ROOT/'assets/controllers/detail.mjs').read_text().replace('export function mount()', 'window.__detailMount = function mount()')
    controller=controller.replace("window.location.replace('/index.html');", "window.__navigatedTo='/index.html';")
    page.add_script_tag(content=controller)
    page.evaluate('window.__detailMount()')
    page.locator('#btnCancelApp').wait_for(state='visible',timeout=5000)

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    for exists in (False,True,None):
        ctx=browser.new_context(viewport={'width':390,'height':844})
        page=ctx.new_page(); errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        setup_page(page,exists)
        if exists is False:
            page.locator('#createSystemBox .setup-link').wait_for(state='visible',timeout=5000)
            assert page.get_by_text('系统尚未初始化').is_visible()
        elif exists is True:
            page.wait_for_function("document.querySelector('.login-card') && !document.querySelector('.setup-checking')", timeout=5000)
            assert page.locator('#createSystemBox').count()==0
        else:
            page.locator('.setup-status-error button').wait_for(state='visible',timeout=5000)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert not errors,errors
        print('PASS setup CTA:',exists)
        ctx.close()
    # The Vue system creation form must remain functional as well as visible.
    ctx=browser.new_context(viewport={'width':375,'height':812})
    page=ctx.new_page(); errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    load_html(page,'create-system',['assets/pages/create-system.css','assets/design.css','assets/mobile-v15.css','assets/initialization-v16.css'])
    page.evaluate("""()=>{
       window.__routePreflightPromise=Promise.resolve(null);
       window.fetch=async (url,opts)=>{
         if(url!=='/api/admin/init-system') throw new Error('wrong endpoint');
         window.__setupPayload=JSON.parse(opts.body);
         return {ok:true,status:201,json:async()=>({message:'created'})};
       };
       Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:()=>null,setItem(){},removeItem(){}}});
    }""")
    page.add_script_tag(content=(ROOT/'vendor/vue.global.js').read_text())
    app=(ROOT/'assets/app.js').read_text().replace("window.location.replace('/login.html');", "window.__setupNavigateTo='/login.html';")
    page.add_script_tag(content=app)
    page.locator('#createForm').wait_for(state='visible',timeout=5000)
    page.locator('#username').fill('rootadmin')
    page.locator('#password').fill('strongPass123')
    page.locator('#confirmPassword').fill('strongPass123')
    page.get_by_role('button',name='创建账户').click()
    page.wait_for_function("window.__setupNavigateTo==='/login.html'",timeout=5000)
    assert page.evaluate('window.__setupPayload')=={'username':'rootadmin','password':'strongPass123','confirmPassword':'strongPass123'}
    assert not errors,errors
    print('PASS system creation Vue form + mocked POST')
    ctx.close()
    for mode in ('confirm-no','error','success'):
        ctx=browser.new_context(viewport={'width':375,'height':812})
        page=ctx.new_page(); errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        detail_page(page)
        page.locator('#btnCancelApp').click()
        page.wait_for_function('typeof window.__confirmCancel === "function"')
        if mode=='confirm-no':
            page.evaluate('window.__confirmCancel(false)')
            assert page.locator('#btnCancelApp').is_enabled()
            assert page.locator('#btnSubmitEdit').is_enabled()
            assert page.locator('#cancelApplicationProgress').count()==0
        else:
            page.evaluate('() => { void window.__confirmCancel(true); }')
            page.locator('#cancelApplicationProgress').wait_for(state='visible',timeout=5000)
            assert page.get_by_text('正在取消申请...',exact=True).is_visible()
            assert page.locator('#btnCancelApp').is_disabled()
            assert page.locator('#btnSubmitEdit').is_disabled()
            assert page.locator('#cancelApplicationProgress button').count()==0
            page.keyboard.press('Escape')
            assert page.locator('#cancelApplicationProgress').is_visible()
            page.evaluate('window.cancelApplication()')
            assert page.evaluate('window.__deleteCount')==1,'should send exactly one DELETE'
            page.evaluate('(ok)=>window.__resolveDelete(ok,"模拟服务器失败")',mode=='success')
            page.locator('#cancelApplicationProgress').wait_for(state='detached',timeout=5000)
            if mode=='error':
                assert page.locator('#btnSubmitEdit').is_enabled()
                assert page.locator('#btnCancelApp').is_enabled()
                assert page.evaluate('window.__error')=='模拟服务器失败'
                assert not page.evaluate('window.__navigatedTo')
            else:
                page.wait_for_function('window.__navigatedTo === "/index.html"')
                assert page.evaluate('window.__success')=='申请已取消'
                assert page.evaluate('window.__emitted') is True
        assert not errors,errors
        print('PASS cancellation:',mode)
        ctx.close()
    browser.close()
