"""Offline Chromium functional and foreground/background regression for v3.4.2."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re, json, statistics, base64
ROOT=Path(__file__).resolve().parents[1]
VUE=(ROOT/'vendor/vue.global.js').read_text()
APP=(ROOT/'assets/app.js').read_text()
THEME=(ROOT/'assets/theme.js').read_text()
NAV_PAGES=['index','about','dashboard','admin','settings','student','upload','detail','messages','music','file-upload','login','student-login','create-system','close']

def fake_html(name):
 text=(ROOT/(name+'.html')).read_text()
 text=re.sub(r'<script\b[^>]*src=[^>]*></script>','',text)
 text=re.sub(r'<link\b[^>]*>','',text)
 style=(ROOT/'assets/core.css').read_text()+'\n'+(ROOT/'assets/pages'/f'{name}.css').read_text()
 text=text.replace('</head>','<style>'+style+'</style></head>')
 return text

calc='''() => {
function rgb(c) {const m=c.match(/rgba?\\(([^)]*)\\)/);if(!m)return null;const n=m[1].split(/[, ]+/).filter(x=>x&&!x.includes('/')).map(Number);return [...n.slice(0,3),n.length>3?n[3]:1];}
function over(a,b){return [0,1,2].map(i=>a[i]*a[3]+b[i]*(1-a[3]));}
function lum(a){const v=a.slice(0,3).map(x=>{x=x/255;return x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4);});return .2126*v[0]+.7152*v[1]+.0722*v[2];}
function ratio(a,b){const l=[lum(a),lum(b)].sort((a,b)=>b-a);return (l[0]+.05)/(l[1]+.05);}
let results=[];
for(const el of document.querySelectorAll('.page-view *,.app-sidebar *,.app-topbar *')){
 if(el.children.length>0 || !el.textContent.trim() || el.getClientRects().length===0)continue;
 let style=getComputedStyle(el);if(style.visibility==='hidden'||style.display==='none'||Number(style.opacity)<.9)continue;
 let fg=rgb(style.color);if(!fg)continue;
 let bg=[255,255,255];let chain=[];let item=el;
 while(item){const s=getComputedStyle(item),v=rgb(s.backgroundColor);if(v&&v[3]>0)chain.push(v);item=item.parentElement;}
 for(const v of chain.reverse())bg=over(v,[...bg,1]);
 fg=over(fg,[...bg,1]);const contrast=ratio(fg,bg);
 if(contrast < 4.5 && !el.closest('button[disabled], [disabled], .badge, .status-tag,.tag,.online-dot')){
 results.push({text:el.textContent.trim().slice(0,22),contrast:+contrast.toFixed(2),color:style.color,bg:'rgb('+bg.map(x=>Math.round(x)).join(',')+')',cls:String(el.className).slice(0,60)});
 }
}
return results.sort((a,b)=>a.contrast-b.contrast).slice(0,25);
}'''
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 for name in NAV_PAGES:
  for mode in ('light','dark'):
   page=browser.new_page(viewport={'width':1280,'height':850})
   # seed storage BEFORE scripts, default public user for settings; admin tests verify link separately
   page.set_content(fake_html(name))
   page.evaluate('''mode => {const storage={'credit:ui-theme:v1':mode};Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>storage[k]||null,setItem:(k,v)=>{storage[k]=String(v);},removeItem:k=>delete storage[k]}});
       window.__routePreflightPromise=null;window.CreditRouteGuard={destination:()=>null,localPath:p=>p};window.syncBus={on:()=>{},emit:()=>{}};
       window.flashError=()=>{};window.flashSuccess=()=>{};
       window.fetch=async(url,options)=>({ok:true,status:200,json:async()=>({info:{title:'学分申请系统',description:'测试简介',version:'3.4.2'},tracks:[],files:[],students:[],apps:[],logs:[],settings:{},items:[],data:[],total:0}),text:async()=>'',blob:async()=>new Blob([])});
     }''',mode)
   page.add_script_tag(content=VUE)
   page.add_script_tag(content=THEME)
   page.add_script_tag(content=APP)
   page.wait_for_timeout(400)
   contrast=page.evaluate(calc)
   if contrast: print(name,mode,'LOW',json.dumps(contrast[:10],ensure_ascii=False))
   else: print(name,mode,'OK')
   if name=='settings':
    assert page.locator('.software-settings').count()==1
    assert page.locator('a.side-link[href="/settings.html"]').count()==1
    if mode=='light':
     page.get_by_role('button',name='深色').click()
     assert page.evaluate('document.documentElement.dataset.theme')=='dark'
     page.get_by_label('启用音乐盒').uncheck()
     assert not page.get_by_label('启用音乐盒').is_checked()
     assert not page.get_by_label('进入系统自动播放').is_enabled()
   page.close()
 browser.close()
