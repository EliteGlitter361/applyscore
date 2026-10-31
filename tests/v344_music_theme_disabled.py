"""Offline Chromium regression for v3.4.4 music header and disabled destructive actions."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
VUE=(ROOT/'vendor/vue.global.js').read_text()
APP=(ROOT/'assets/app.js').read_text()
THEME=(ROOT/'assets/theme.js').read_text()
CSS=(ROOT/'assets/core.css').read_text()
MUSIC_CSS=(ROOT/'assets/pages/music.css').read_text()

mock_js="""(mode) => {
 const data={}; Object.defineProperty(window, 'localStorage', {configurable:true,value:{
 getItem:k=> k==='credit:ui-theme:v1'?mode:(data[k]||null),setItem:(k,v)=>data[k]=String(v),removeItem:k=>delete data[k]
 }});
 window.__routePreflightPromise=null;window.CreditRouteGuard={destination:()=>null,localPath:p=>p};
 window.syncBus={on:()=>{},emit:()=>{}};window.flashError=()=>{};window.flashSuccess=()=>{};
 window.fetch=async()=>({ok:true,status:200,json:async()=>({tracks:[],settings:{},apps:[],students:[],logs:[],files:[],items:[],info:{}}),blob:async()=>new Blob([]),text:async()=>''});
}"""

def body(page):
    src=(ROOT/(page+'.html')).read_text()
    src=re.sub(r'<script\b[^>]*src=[^>]*></script>', '',src)
    src=re.sub(r'<link\b[^>]*>', '',src)
    page_css=(ROOT/'assets/pages'/f'{page}.css').read_text()
    return src.replace('</head>',f'<style>{page_css}\n{CSS}</style></head>')

def vue(page):
    page.add_script_tag(content=VUE)
    page.add_script_tag(content=THEME)
    page.add_script_tag(content=APP)
    page.wait_for_timeout(100)

def rgb(color):
    nums=re.findall(r'[-+]?\d*\.?\d+',color)
    return [float(n) for n in nums[:3]]

def luminance(c):
    parts=[x/255 for x in rgb(c)]
    parts=[x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in parts]
    return .2126*parts[0]+.7152*parts[1]+.0722*parts[2]

def contrast(a,b):
    l1,l2=sorted([luminance(a),luminance(b)])
    return (l2+.05)/(l1+.05)

with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    for mode in ['light','dark']:
        for width in [320,390,768,1280]:
            pg=browser.new_page(viewport={'width':width,'height':850})
            pg.set_content(body('music'))
            pg.evaluate(mock_js,mode)
            vue(pg)
            pg.evaluate("""() => {
              const root=document.getElementById('app').__vue_app__._container._vnode;
              const f=v=>{if(!v)return null;if(v.component?.type?.name==='PageContent')return v.component.proxy;
                return f(v.component?.subTree)||(Array.isArray(v.children)?v.children.map(f).find(Boolean):null)};
              const v=f(root);v.musicLoading=false;v.musicTracks=Array.from({length:41},(_,i)=>({id:'id'+i,name:'乐曲 '+i+'.mp3',size:1234000}));
            }""")
            pg.wait_for_timeout(80)
            toolbar=pg.locator('.music-manager-toolbar')
            banner=toolbar.evaluate("""e=>{const c=getComputedStyle(e);const r=e.getBoundingClientRect();return {background:c.backgroundColor,backgroundImage:c.backgroundImage,borderTop:c.borderTopWidth,shadow:c.boxShadow,padding:c.padding,rect:[r.x,r.y,r.width,r.height]}}""")
            assert banner['background'] in ['rgba(0, 0, 0, 0)','transparent'],f'{mode} {width} toolbar: {banner}'
            assert banner['backgroundImage']=='none' and banner['shadow']=='none',str(banner)
            assert banner['borderTop']=='0px' and banner['padding']=='0px',str(banner)
            assert toolbar.locator('b').inner_text()=='音乐库 · 41 首'
            import_bg=pg.locator('.music-import-button').evaluate('e=>getComputedStyle(e).backgroundColor')
            assert contrast(import_bg,'rgb(255,255,255)')>=4.5,(mode,'import',import_bg)
            danger=pg.locator('.music-manager-actions .music-danger-btn')
            assert danger.is_disabled()
            computed=danger.evaluate("""e=>{const s=getComputedStyle(e);return {bg:s.backgroundColor,fg:s.color,opacity:s.opacity,cursor:s.cursor,fill:s.webkitTextFillColor}}""")
            r=contrast(computed['bg'],computed['fg'])
            assert r>=4.5,(mode,width,'music disabled',computed,r)
            assert computed['opacity']=='1' and computed['cursor']=='not-allowed',computed
            pg.locator('.music-manager-track input[type=checkbox]').first.check()
            assert danger.is_enabled(),f'{mode} {width}: bulk delete not enabled'
            active_bg=danger.evaluate('e=>getComputedStyle(e).backgroundColor')
            assert active_bg!=computed['bg'],f'disabled indistinguishable from enabled: {computed}'
            if width==390:
                pg.screenshot(path=str(ROOT.parent/f'v344_music_{mode}.png'),full_page=False)
            print('MUSIC',mode,width,'header transparent','button contrast',round(r,2),'active bg',active_bg)
            pg.close()
        # Verify actual destructive buttons in other pages at representative desktop/mobile sizes.
        for name in ['dashboard','student','detail','admin']:
            pg=browser.new_page(viewport={'width':390,'height':850})
            pg.set_content(body(name));pg.evaluate(mock_js,mode);vue(pg)
            pg.evaluate("""() => {
              const parent=document.querySelector('.page-view')||document.body;
              const d=document.createElement('button'); d.className='btn btn-danger'; d.disabled=true; d.textContent='删除选中';d.id='test-disabled-danger';parent.append(d);
            }""")
            color=pg.locator('#test-disabled-danger').evaluate("""e=>{const s=getComputedStyle(e);return {bg:s.backgroundColor,fg:s.color,opacity:s.opacity,cursor:s.cursor}}""")
            c=contrast(color['bg'],color['fg'])
            assert c>=4.5 and color['opacity']=='1' and color['cursor']=='not-allowed',(mode,name,color,c)
            print('DISABLED',name,mode,round(c,2))
            pg.close()
    browser.close()
print('PASS music title, disabled-danger contrast, and cross-page styling')
