"""Vue 3 + system administrator workflow under a deterministic mocked API.
Uses real packaged admin controller and Vue runtime; does not call cloud services.
"""
from pathlib import Path
import base64, re
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent

def inline_view():
    html=(ROOT/'admin.html').read_text()
    def css(m):
        p=ROOT/m.group(1).lstrip('/').split('?')[0]
        return '<style>'+p.read_text()+'</style>' if p.exists() else ''
    html=re.sub(r'<link rel="stylesheet" href="(/[\w./-]+(?:\?v=[\w.]+)?)"\s*/>',css,html)
    def js(m):
        p=ROOT/m.group(1).lstrip('/').split('?')[0]
        if p.name=='route-guard.js':return ''
        return '<script>'+p.read_text()+'</script>' if p.exists() else ''
    html=re.sub(r'<script(?: defer)? src="(/[\w./-]+(?:\?v=[\w.]+)?)"></script>',js,html)
    app=(ROOT/'assets/app.js').read_text()
    uri='data:text/javascript;base64,'+base64.b64encode((ROOT/'assets/controllers/admin.mjs').read_bytes()).decode()
    modified=app.replace("import('/assets/controllers/' + page + '.mjs?v=1.5')",f"import('{uri}')")
    assert modified!=app
    html=html.replace('<script>'+app+'</script>','').replace('</body>','<script>'+modified+'</script></body>')
    mock='''<script>
    const mockItems={adminToken:'test-token',adminUser:JSON.stringify({role:'system',username:'system'})};
    Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>mockItems[k]??null,setItem:(k,v)=>mockItems[k]=v,removeItem:k=>delete mockItems[k]}});
    window.fetch=async url=>({ok:true,status:200,headers:{get:()=>null},
      json:async()=>String(url).includes('/api/admin')?[{id:1,username:'audit-user',role:'admin',auditPermission:1,canBan:0}]:String(url).includes('/api/settings')?{}:[], text:async()=>''});
    </script>'''
    return html.replace('</head>',mock+'</head>')

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':375,'height':800})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(inline_view(),wait_until='domcontentloaded')
    page.locator('.vue-admin-table tbody tr').first.wait_for(timeout=4000)
    assert page.locator('.vue-admin-table tbody tr').first.is_visible(), 'first admin row hidden on mobile'
    assert page.locator('.vue-admin-table tbody tr').first.inner_text().find('audit-user') >=0
    assert page.evaluate('typeof window.togglePerm')=='function'
    first=page.locator('.vue-admin-table tbody tr button.toggle-btn').first
    assert first.inner_text()=='开启'
    first.click(); page.wait_for_timeout(90)
    assert first.inner_text()=='关闭','permission toggle did not update reactive Vue list'
    assert not errors,'browser page errors: '+str(errors)
    browser.close()
print('PASS mocked system account: admin list loads into Vue, first row visible on phone, toggle updates reactive data')
