"""Offline dynamic-state smoke test: setup/auth cards, music toolbar/rows, contrast, icons."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json,re
R=Path(__file__).resolve().parents[1]
V=(R/'vendor/vue.global.js').read_text()
A=(R/'assets/app.js').read_text()
T=(R/'assets/theme.js').read_text()
def html(name):
 s=(R/(name+'.html')).read_text()
 s=re.sub(r'<script\b[^>]*src=[^>]*></script>','',s)
 s=re.sub(r'<link\b[^>]*>','',s)
 css=(R/'assets/pages'/f'{name}.css').read_text()+'\n'+(R/'assets/core.css').read_text()
 return s.replace('</head>','<style>'+css+'</style></head>')
mock="""(mode) => {const data={}; Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>k==='credit:ui-theme:v1'?mode:(data[k]||null),setItem:(k,v)=>data[k]=String(v),removeItem:k=>delete data[k]}});window.__routePreflightPromise=null;window.CreditRouteGuard={destination:()=>null,localPath:p=>p};window.syncBus={on:()=>{},emit:()=>{}};window.flashError=()=>{};window.flashSuccess=()=>{};window.fetch=async()=>({ok:true,status:200,json:async()=>({tracks:[],settings:{},apps:[],students:[],logs:[],files:[],items:[],info:{}}),blob:async()=>new Blob([]),text:async()=>''});}"""

with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 errors=[]
 for name in ['login','index','create-system','music','settings']:
  for mode in ['light','dark']:
   for width in [320,390,768,1280] if name=='music' else [390,1280]:
    pg=browser.new_page(viewport={'width':width,'height':850})
    pg.set_content(html(name))
    pg.evaluate(mock,mode)
    pg.add_script_tag(content=V);pg.add_script_tag(content=T);pg.add_script_tag(content=A)
    pg.wait_for_timeout(120)
    if name=='login':
     pg.evaluate("""() => {const root=document.getElementById('app').__vue_app__._container._vnode;const f=v=>{if(!v)return null;if(v.component?.type?.name==='PageContent')return v.component.proxy;return f(v.component?.subTree)|| (Array.isArray(v.children)?v.children.map(f).find(Boolean):null)};const v=f(root);v.systemStatus='uninitialized';}""")
     pg.wait_for_timeout(50)
     sel='.create-system'
    elif name=='index':
     pg.evaluate("""() => {const root=document.getElementById('app').__vue_app__._container._vnode;const f=v=>{if(!v)return null;if(v.component?.type?.name==='PageContent')return v.component.proxy;return f(v.component?.subTree)|| (Array.isArray(v.children)?v.children.map(f).find(Boolean):null)};const v=f(root);if(v){v.indexTab='needs-fix';v.indexLoggedIn=false;v.indexError='';}}""")
     pg.wait_for_timeout(50)
     sel='.login-prompt'
    elif name=='music':
     pg.evaluate("""() => {const root=document.getElementById('app').__vue_app__._container._vnode;const f=v=>{if(!v)return null;if(v.component?.type?.name==='PageContent')return v.component.proxy;return f(v.component?.subTree)|| (Array.isArray(v.children)?v.children.map(f).find(Boolean):null)};const v=f(root);v.musicLoading=false;v.musicTracks=Array.from({length:9},(_,i)=>({id:'a'+i,name:'示例音乐的非常非常长的中文名称用于测试行数和窄屏布局 '+i+'.mp3',size:4*1024*1024}));}""")
     pg.wait_for_timeout(60)
     sel='.music-manager-card'
    elif name=='create-system': sel='#formContainer'
    else: sel='.settings-pane:first-of-type'
    try:
     el=pg.locator(sel)
     assert el.count(), f'{name} {mode} {width}: state {sel} missing'
     info=el.evaluate("""el=>{const st=getComputedStyle(el),r=el.getBoundingClientRect();return {bg:st.backgroundColor,fg:st.color,rect:[r.x,r.y,r.width,r.height]}}""")
     if mode=='dark':
      assert info['bg'] not in ['rgb(255, 255, 255)','rgba(0, 0, 0, 0)'],f'{name} white or transparent: {info}'
     if name=='music':
      pos=pg.evaluate("""() => {const rect=e=>{const r=e.getBoundingClientRect();return [r.left,r.right,r.top,r.bottom]};return {viewport:window.innerWidth,toolbar:rect(document.querySelector('.music-manager-toolbar')),track:rect(document.querySelector('.music-manager-track')),buttons:[...document.querySelectorAll('.music-manager-track-actions button')].map(rect),card:rect(document.querySelector('.music-manager-card')),listGap:getComputedStyle(document.querySelector('.music-manager-list')).rowGap,disabledCursor:getComputedStyle(document.querySelector('.music-manager-actions .music-danger-btn')).cursor}}""")
      pg.evaluate("""() => {document.querySelector('.music-manager-actions .music-danger-btn').disabled=true;}""")
      pos['disabledCursor']=pg.locator('.music-manager-actions .music-danger-btn').evaluate('(el)=>getComputedStyle(el).cursor')
      assert pos['disabledCursor'] not in ('wait','progress'),f'disabled cursor wrong: {pos}'
      assert pos['track'][1]<=width+2, f'track overflow: {pos}'
      assert all(x[1]<=width+2 for x in pos['buttons']),f'buttons overflow: {pos}'
      assert pos['listGap']!='0px',f'no row separation {pos}'
      if width==390:
       pg.locator('.music-select-row input[type=checkbox]').check()
       assert pg.locator('.music-manager-actions .music-danger-btn').is_enabled()
       pg.locator('.music-manager-actions .music-danger-btn').click()
       assert pg.locator('.music-delete-overlay').is_visible()
       assert '9 首' in pg.locator('.music-delete-dialog').inner_text()
       pg.locator('.music-delete-actions button').first.click()
       assert not pg.locator('.music-delete-overlay').count()
     if name=='login':
      hd=pg.locator('.create-system strong').evaluate('(e)=>getComputedStyle(e).color');print('SETUP',mode,width,info['bg'],hd)
     if name=='index': print('LOGIN_PROMPT',mode,width,info['bg'])
     if name=='music': print('MUSIC',mode,width,'track',pos['track'],'gap',pos['listGap'])
    except Exception as exc:
     errors.append(str(exc));print('FAIL',name,mode,width,str(exc))
    pg.close()
 browser.close()
 assert not errors, '\n'.join(errors)
print('PASS dynamic states and music layout')
