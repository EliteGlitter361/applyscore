"""Headless browser regression for Vue theme state and independent ball/window anchors."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re, json
R=Path(__file__).resolve().parents[1]
markup='''<div class="app-frame"><aside class="app-sidebar"><div class="brand"><span class="brand-copy"><b>学分服务中心</b></span></div><a class="side-link selected"><span class="side-icon">♫</span>学分总览</a></aside><main class="app-main"><div class="app-topbar"><span class="breadcrumb"><b>学分总览</b></span><button class="theme-toggle"><span class="theme-glyph"></span></button></div><div class="app-stage"><div class="page-view"><div class="tabs-wrap"><div class="tabs"><button class="tab-btn active">待发放的学分</button><button class="tab-btn">需要修改的学分</button></div></div><div class="app-grid"><div class="app-card"><h2 class="app-title">活动名称</h2><div class="app-student">申请人</div></div></div><div class="about-public-card"><h2>关于</h2><p class="about-description">欢迎使用</p><div class="about-metadata"><div><span>系统信息</span><strong>24市场营销</strong></div></div></div></div></div></main></div>'''
styles='\n'.join((R/p).read_text() for p in ('assets/pages/index.css','assets/pages/about.css','assets/core.css'))
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 for width in (320,375,390,768,1280):
  page=browser.new_page(viewport={'width':width,'height':850})
  page.set_content('<html data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+styles+'</style></head><body class="page-index">'+markup+'</body></html>')
  def collect():
   return page.evaluate('''() => { const rect=x=>{let r=document.querySelector(x).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};const st=x=>getComputedStyle(document.querySelector(x));return {tab:rect('.tab-btn'),group:rect('.tabs'),card:st('.app-card').backgroundColor,title:st('.app-title').color,about:st('.about-public-card').backgroundColor,sidebar:st('.app-sidebar').backgroundColor,html:st('html').backgroundColor,scroll:document.documentElement.scrollWidth}}''')
  light=collect()
  page.evaluate("document.documentElement.dataset.theme='dark'")
  page.wait_for_timeout(300)
  dark=collect()
  for key in ('tab','group'):
   for measure in ('x','y','w','h'):
    assert abs(light[key][measure]-dark[key][measure])<1,(width,key,measure,light[key],dark[key])
  for key in ('card','about','sidebar'):
   assert light[key]!=dark[key],(width,'palette stuck',key,light,dark)
  assert dark['card']!='rgb(255, 255, 255)',(width,'card remains light')
  assert dark['title']!='rgb(11, 30, 58)',(width,'ink remains too dark')
  assert light['scroll']<=width+1 and dark['scroll']<=width+1,(width,light,dark)
  print('PASS theme palette and stable geometry',width)
  page.close()

 # Test prepaint theme + Vue reactive state, then persistence.
 page=browser.new_page()
 page.set_content('<html><head><meta name="theme-color" content="#ffffff"></head><body></body></html>')
 page.evaluate("""() => {const store={}; Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=String(v)}})}""")
 page.add_script_tag(content=(R/'assets/theme.js').read_text())
 page.add_script_tag(content=(R/'vendor/vue.global.js').read_text())
 result=page.evaluate('''() => {const s=window.CreditTheme.useTheme();CreditTheme.set('dark');const dark=s.value;CreditTheme.toggle();return [dark,s.value,document.documentElement.dataset.theme,localStorage.getItem('credit:ui-theme:v1')]}''')
 assert result==['dark','light','light','light'],result
 print('PASS Vue-ref theme state + persistence')
 page.close()

 for width in (390,1280):
  page=browser.new_page(viewport={'width':width,'height':850})
  source=(R/'music-shell.html').read_text()
  source=re.sub(r'<script\b[^>]*></script>','',source)
  source=re.sub(r'<link\b[^>]*>','',source)
  source=source.replace('</head>','<style>'+(R/'assets/music-core.css').read_text()+'</style></head>')
  page.set_content(source,wait_until='domcontentloaded')
  page.evaluate('''() => {const store={'credit:nbs:options:v2':JSON.stringify({enabled:true,showIsland:true,islandCollapsed:true,autoPlay:false})}; Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=String(v)}});
   window.fetch=async url=>new Response(JSON.stringify({tracks:[]}),{status:200,headers:{'Content-Type':'application/json'}});
   window.CreditTheme={read:()=> 'light',toggle:()=> 'dark',set:()=> 'light'};
   HTMLMediaElement.prototype.play=function(){return Promise.resolve()};HTMLMediaElement.prototype.pause=function(){};HTMLMediaElement.prototype.load=function(){};
  }''')
  page.add_script_tag(content=(R/'vendor/vue.global.js').read_text())
  js=(R/'assets/music-shell.js').read_text().replace("if(view.startsWith('/')&&!view.startsWith('//'))this.frame.src=view+(view.includes('?')?'&':'?')+'__music_embed=1';",'/* test: no remote iframe */')
  page.add_script_tag(content=js)
  page.wait_for_function('document.querySelector("#music-root").__vue_app__')
  proxy='document.querySelector("#music-root").__vue_app__._container._vnode.component.proxy'
  page.evaluate(f'{proxy}.frameBusy=false')
  page.locator('.nbs-floating-ball').wait_for()
  # Simulate a real pointer-drag to the lower-right corner.
  page.evaluate(f'{proxy}.ballPosition={{x:Math.floor(innerWidth/2),y:290}}')
  page.wait_for_timeout(60)
  box=page.locator('.nbs-floating-ball').bounding_box()
  page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
  page.mouse.down()
  page.mouse.move(width-44,710,steps=9)
  page.mouse.up()
  page.wait_for_timeout(80)
  dragged=page.evaluate(f'{proxy}.ballPosition')
  assert dragged['x']>=width-85 and dragged['y']>500,(width,'real drag not applied',dragged)
  # Expand into the wider window, then minimize back to the identical anchor.

  initial=page.locator('.nbs-island').bounding_box()
  page.locator('.nbs-floating-ball').click()
  page.locator('.island-collapse').wait_for()
  page.locator('.island-collapse').click()
  page.locator('.nbs-floating-ball').wait_for()
  last=page.locator('.nbs-island').bounding_box()
  assert abs(initial['x']-last['x'])<1 and abs(initial['y']-last['y'])<1,(width,'ball moved',initial,last)
  # Persist independent coordinates and ensure previous ball coords unchanged when window dragged/clamped.
  ball=page.evaluate(f'{proxy}.ballPosition')
  page.locator('.nbs-floating-ball').click()
  page.evaluate(f'{proxy}.windowPosition={{x:10,y:10}}')
  page.evaluate(f'{proxy}.clampIsland()')
  page.locator('.island-collapse').click()
  assert page.evaluate(f'{proxy}.ballPosition')==ball,(width,'ball anchor overwritten')
  print('PASS independent floating-ball anchor, restored after expand/minimize',width)
  page.close()
 browser.close()
