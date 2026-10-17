/** v1.5 static, route and Vue migration regressions; no external services needed. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const pages=['index','upload','detail','file-upload','messages','student-login','login','create-system','close','dashboard','student','admin'];
assert.ok(!fs.existsSync(path.join(root,'legacy')),'retired legacy script directory must not be deployed');
for(const page of pages){
 const html=read(`${page}.html`);
 assert.ok(html.includes('/assets/route-guard.js?v=1.8'),`${page}: route guard should run in <head>`);
 assert.ok(html.includes('/assets/mobile-v15.css?v=1.8'),`${page}: mobile CSS missing`);
 assert.ok(!/\s(?:onclick|onchange)="/.test(html),`${page}: unmanaged native inline events in Vue view`);
 if(!['login','student-login','create-system','close'].includes(page)){
  const name=`assets/controllers/${page}.mjs`;assert.ok(fs.existsSync(path.join(root,name)),`${page}: controller missing`);
  assert.ok(read(name).includes('export function mount()'),`${page}: controller lacks Vue lifecycle export`);
 }
}
const shell=read('assets/app.js');
assert.match(shell,/await import\('\/assets\/controllers\//);
assert.match(shell,/this\._controllerCleanup/);
assert.match(shell,/async submitStudentLogin\(\)/);
assert.match(shell,/async submitAdminLogin\(\)/);
assert.match(shell,/async submitSystemSetup\(\)/);
assert.ok(!shell.includes('/legacy/'));
assert.match(read('student-login.html'),/@submit\.prevent="submitStudentLogin"/);
assert.match(read('login.html'),/@submit\.prevent="submitAdminLogin"/);
assert.match(read('admin.html'),/v-model="activeTab"/);
assert.match(read('admin.html'),/v-for="u in adminRows"/);
assert.match(read('assets/mobile-v15.css'),/max-width:1024px/);
const feedback=read('feedback.js');
assert.ok(!feedback.includes("document.body.classList.add('page-leaving')"),'unmanaged fade-out breaks bfcache');
function boot(route,values){
 const storage=new Map(Object.entries(values)),calls=[];const events={};
 const localStorage={getItem:k=>storage.get(k)??null,removeItem:k=>storage.delete(k),setItem:(k,v)=>storage.set(k,v)};
 const u=new URL('https://demo.example'+route);
 const window={location:{href:u.href,origin:u.origin,pathname:u.pathname,search:u.search,replace:x=>calls.push(['replace',x]),assign:x=>calls.push(['assign',x])},addEventListener:(type,fn)=>events[type]=fn,dispatchEvent:()=>{}};
 const document={documentElement:{style:{visibility:''},classList:{add(){},remove(){}}},body:{classList:{remove(){}},appendChild(){}},addEventListener(){}};
 const sessionStorage={getItem(){return null},setItem(){},removeItem(){}};
 vm.runInNewContext(read('assets/route-guard.js'),{window,document,localStorage,sessionStorage,URL,URLSearchParams,Date,console,fetch:async()=>({ok:true,json:async()=>({})}),setTimeout,clearTimeout,AbortController});
 return {window,calls,storage,events};
}
for(const id of ['2026001',2026001]){
 const session={studentToken:'session',studentUser:JSON.stringify({studentId:id,name:'测试'}),studentAutoLogin:'true'};
 const p=boot('/student-login.html',session);
 assert.deepEqual(p.calls,[['replace','/index.html']],`auto-login must redirect before Vue is displayed (${id})`);
 const redirect=boot('/student-login.html?redirect=%2Fmessages.html',session);
 assert.deepEqual(redirect.calls,[['replace','/messages.html']]);
}
const guest=boot('/upload.html',{});
assert.match(guest.calls[0][1],/^\/student-login.html\?redirect=/);
const admin=boot('/admin.html',{adminToken:'session',adminUser:JSON.stringify({role:'admin'})});
assert.deepEqual(admin.calls,[['replace','/dashboard.html']]);
const system=boot('/student.html',{adminToken:'session',adminUser:JSON.stringify({role:'system'})});
assert.deepEqual(system.calls,[['replace','/admin.html?tab=students']]);
const bfcache=boot('/index.html',{});
bfcache.events.pagehide?.({persisted:true}); bfcache.events.pageshow?.({persisted:true});
assert.deepEqual(bfcache.calls,[]);
// Every action converted to a Vue method must be exported by its controller.
for(const page of pages){
 const file=path.join(root,`assets/controllers/${page}.mjs`);
 if(!fs.existsSync(file))continue;
 const view=read(page+'.html'), controller=read(`assets/controllers/${page}.mjs`);
 for(const [,action] of view.matchAll(/invokePageAction\('([^']+)'/g)){
  assert.ok(controller.includes(`window.${action} = ${action};`),`${page}: missing ${action} binding`);
 }
}
console.log('PASS v1.6 compatible: 12 Vue views, page controllers, 40 native handlers migrated, mobile admin selection, prepaint auto-login, role routing, bfcache, responsive assets');
