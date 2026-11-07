"""Standalone Chromium check of only the v3.4.5 homepage announcement component."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
ROOT=Path(__file__).resolve().parents[1]
s=(ROOT/'index.html').read_text()
match=re.search(r'(<div v-if="indexAnnouncementOpen" class="announcement-overlay"[\s\S]*?</section>\s*</div>)',s)
assert match, 'announcement markup not found'
frag=match.group(1)
styles=(ROOT/'assets/core.css').read_text()+'\n'+(ROOT/'assets/pages/index.css').read_text()
vue=(ROOT/'vendor/vue.global.js').read_text()
with sync_playwright() as play:
    browser=play.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    for theme in ['light','dark']:
        for width in [320,390,768,1280]:
            pg=browser.new_page(viewport={'width':width,'height':850})
            pg.set_content('<html data-theme="'+theme+'"><head><style>'+styles+'</style></head><body class="page-index"><div class="page-view"><div id="app">'+frag+'</div></div></body></html>')
            pg.add_script_tag(content=vue)
            pg.evaluate('''() => {window.__view=Vue.createApp({data:()=>({indexAnnouncementOpen:true,indexAnnouncementTitle:'系统维护通知',indexAnnouncementMessage:'请关注服务开放时间。\\n具体请看系统公告。',indexAnnouncementShowConfirm:true}),methods:{indexCloseAnnouncement(){this.indexAnnouncementOpen=false}}}).mount('#app')}''')
            notice=pg.locator('.announcement-notice')
            assert notice.is_visible(), (theme,width)
            bounds=notice.bounding_box()
            assert bounds['x']>=0 and bounds['x']+bounds['width']<=width+1,(theme,width,bounds)
            assert pg.locator('.announcement-confirm').is_visible()
            bg=notice.evaluate('(el)=>getComputedStyle(el).backgroundColor')
            assert bg != 'rgba(0, 0, 0, 0)',(theme,width,bg)
            pg.locator('.announcement-confirm').click()
            assert pg.locator('.announcement-overlay').count()==0
            pg.evaluate('''() => {window.__view.indexAnnouncementOpen=true;window.__view.indexAnnouncementShowConfirm=false}''')
            assert notice.is_visible() and pg.locator('.announcement-confirm').count()==0
            print('PASS notice card',theme,width,bg)
            pg.close()
    browser.close()
