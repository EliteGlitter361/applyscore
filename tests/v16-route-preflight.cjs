/** v1.6 prepaint route guards and initialization checks, entirely offline. */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'assets/route-guard.js'),'utf8');
async function initCase(exists, status=200) {
  const url=new URL('https://test.example/create-system.html');
  const listeners={};const calls=[]; const requested=[];
  const win={location:{href:url.href,pathname:url.pathname,origin:url.origin,replace:u=>calls.push(u),assign:u=>calls.push(u)},addEventListener:(type,fn)=>listeners[type]=fn,dispatchEvent:()=>{}};
  const document={documentElement:{style:{visibility:''},classList:{add(){},remove(){}}},body:{classList:{remove(){}},appendChild(){}},addEventListener:()=>{}};
  vm.runInNewContext(source,{window:win,document,URL,URLSearchParams,Date,console,setTimeout,clearTimeout,
    AbortController,
    localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},
    fetch:async (path,opt)=>{requested.push([path,opt]); return {ok:status===200,status,json:async()=>status===200?{exists}:{error:'模拟状态接口不可用'}};}
  });
  assert.ok(win.__routePreflightPromise,'init status must be checked before Vue mount');
  if(status!==200) await assert.rejects(win.__routePreflightPromise,/模拟状态接口不可用/);
  else assert.equal(await win.__routePreflightPromise,exists?'/login.html':null);
  assert.equal(requested.length,1);
  assert.equal(requested[0][0],'/api/admin/check-system');
  assert.equal(requested[0][1].cache,'no-store');
  assert.deepEqual(calls,[],'route-guard preflight itself must not paint/redirect');
  console.log('PASS init preflight',exists,status);
}
(async()=>{
 await initCase(false); await initCase(true); await initCase(false,503);
 const login=fs.readFileSync(path.join(root,'login.html'),'utf8');
 assert.match(login,/systemStatus === 'uninitialized'/);
 assert.match(login,/href="\/create-system.html"/);
 assert.match(fs.readFileSync(path.join(root,'functions/_middleware.js'),'utf8'),/url\.pathname === '\/api\/admin\/check-system'/);
 console.log('PASS route preflight and no-store initialization status');
})().catch(err=>{console.error(err);process.exitCode=1});
