"""Offline Chromium layout smoke test; no Cloudflare or localhost network access required.

Requires Python playwright and local Chromium. It inlines the actual packaged Vue,
styles and app shell; controllers' cloud calls are intentionally not executed.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
ROOT=Path(__file__).resolve().parent.parent

def document_for(name):
    html=(ROOT/(name+'.html')).read_text()
    def css(match):
        path=ROOT/match.group(1).lstrip('/').split('?')[0]
        return '<style>'+path.read_text()+'</style>' if path.exists() else ''
    html=re.sub(r'<link rel="stylesheet" href="(/[\w./-]+(?:\?v=[\w.]+)?)"\s*/>',css,html)
    def js(match):
        path=ROOT/match.group(1).lstrip('/').split('?')[0]
        if path.name=='route-guard.js':return ''  # route guard tested separately
        return '<script>'+path.read_text().replace('</script>','<\\/script>')+'</script>' if path.exists() else ''
    html=re.sub(r'<script(?: defer)? src="(/[\w./-]+(?:\?v=[\w.]+)?)"></script>',js,html)
    app='<script>'+(ROOT/'assets/app.js').read_text().replace('</script>','<\\/script>')+'</script>'
    html=html.replace(app,'').replace('</body>',app+'</body>')
    return html

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    for name in ('admin','login','student-login','index','file-upload','dashboard','student','upload','detail','messages','create-system','close'):
        for width in (320,375,390,768,1050):
            page=browser.new_page(viewport={'width':width,'height':812})
            page.set_content(document_for(name),wait_until='domcontentloaded')
            page.wait_for_timeout(65)
            state=page.evaluate('''() => ({width:innerWidth, html:document.documentElement.scrollWidth,
                app:document.querySelector('#app')?.getBoundingClientRect().width,
                view:!!document.querySelector('.page-view'),
                select:document.querySelector('.admin-mobile-tab-select')?.getBoundingClientRect().width || 0,
                tabs:document.querySelector('.tabs-wrap') && getComputedStyle(document.querySelector('.tabs-wrap')).display})''')
            assert state['view'], f'{name} {width} failed to render Vue view'
            assert state['html']<=width+1, f'{name} at {width}: document overflow {state}'
            assert state['app']<=width+1, f'{name} at {width}: shell overflow {state}'
            if name=='admin':
                if width<=1024:
                    assert state['select'] > 0, f'{name} {width}: missing responsive select'
                    assert state['tabs']=='none', f'{name} {width}: old tabs still showing'
                    page.select_option('.admin-mobile-tab-select select','files')
                    assert page.locator('#tab-files').is_visible(), 'Vue tab change did not update active panel'
                    page.evaluate('''() => window.__vueAdminUpdate?.([{id:1,username:'测试管理员',role:'admin',auditPermission:1,canBan:0}])''')
                    # switch back and verify reactive data table only in admin tab.
                    page.select_option('.admin-mobile-tab-select select','admins')
                    assert page.locator('.vue-admin-table tbody tr').count()==1, 'Vue admin table did not react'
                else: assert state['tabs']=='flex', f'{name} {width}: desktop tab row missing'
            if name in ('login','student-login'):
                assert page.locator('#loginForm').is_visible(), f'{name} {width}: login unavailable'
                assert page.locator('.login-card').bounding_box()['width']<=width+1
            page.close()
    browser.close()
print('PASS offline Chromium: 12 Vue pages at 320/375/390/768/1050px, responsive admin select, reactive admin list, login cards; no horizontal document overflow')
