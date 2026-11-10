from pathlib import Path
from playwright.sync_api import sync_playwright
import re
ROOT=Path(__file__).resolve().parents[1]
def html_for():
    h=(ROOT/'messages.html').read_text()
    h=re.sub(r'<script\b[^>]*>.*?</script>','',h,flags=re.S)
    h=re.sub(r'<link\b[^>]*>','',h)
    css=(ROOT/'assets/core.css').read_text()+'\n'+(ROOT/'assets/pages/messages.css').read_text()
    h=h.replace('</head>','<style>'+css+'</style></head>')
    h=h.replace('<div id="app">','<div id="app"><div class="app-frame"><main class="app-main"><section class="page-view">')
    h=h.replace('</body>','</section></main></div></body>')
    return h
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    for mode in ('light','dark'):
        page=browser.new_page(viewport={'width':1280,'height':850},reduced_motion='no-preference')
        page.set_content(html_for())
        page.evaluate("""mode=>{
          document.documentElement.dataset.theme=mode;
          document.querySelector('#app').innerHTML=`<div class="app-frame"><main class="app-main"><section class="page-view">
          <div class="navbar"><h1>我的消息</h1></div><div class="container"><div class="msg-list">
          <button class="msg-item"><span class="msg-main"><span class="msg-title"><span class="msg-type-tag rejected">未通过</span>学分申请未通过</span><span class="msg-preview">您的活动学分申请未通过审核。</span></span><span class="msg-meta"><span class="msg-time">刚刚</span></span></button>
          </div></div></section></main></div>`;
        }""",mode)
        card=page.locator('.msg-item')
        card.wait_for()
        def color(sel,prop): return page.locator(sel).evaluate("(e,p)=>getComputedStyle(e).getPropertyValue(p)",prop)
        bg=color('.msg-item','background-color')
        fg=color('.msg-title','color')
        assert bg!= 'rgba(0, 0, 0, 0)',(mode,bg)
        assert ('28, 43, 64' in bg or '28, 43, 64' in bg) if mode=='dark' else ('255, 255, 255' in bg),(mode,bg)
        before=color('.navbar h1','text-shadow')
        card.hover()
        after=color('.navbar h1','text-shadow')
        title_shadow=color('.msg-title','text-shadow')
        assert before==after and 'none' in after,(mode,before,after)
        assert 'none' in title_shadow,(mode,title_shadow)
        anim=page.locator('.app-frame').evaluate('(e)=>getComputedStyle(e).animationName')
        assert 'creditPageEnter' in anim,(mode,anim)
        print('PASS messages palette, hover text shadow isolation and page entrance',mode,bg,fg,anim)
        page.close()
    page=browser.new_page(reduced_motion='reduce')
    page.set_content(html_for())
    page.locator('#app').evaluate("e=>e.innerHTML='<div class=\"app-frame\"><div class=\"page-view\">page</div></div>'")
    assert page.locator('.app-frame').evaluate('(e)=>getComputedStyle(e).animationName')=='none'
    print('PASS reduced motion preference')
    browser.close()
