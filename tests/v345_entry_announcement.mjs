import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const root=path.resolve(import.meta.dirname,'..');
let settings={enabled:false,message:'暂不开放学分申请',announcementEnabled:true,announcementMessage:'维护公告',announcementTitle:'系统公告',announcementShowConfirm:false};
let readFiles=[];let writes=[];
globalThis.__testGitee={
  getFileFromGitee:async (_env,p)=>{readFiles.push(p);return {content:p==='data/settings.json'?settings:[],sha:'revision1'}},
  writeJsonToGitee:async(_env,p,value)=>{writes.push(p);settings={...value}},
  writeFileToGitee:async()=>{throw Error('screenshot upload should not be reached')}
};
async function importFunc(f){
 let src=fs.readFileSync(path.join(root,f),'utf8').replace(/^import \{[^\n]*\} from '\.\.\/utils\/gitee';/m,'const {getFileFromGitee, writeJsonToGitee, writeFileToGitee}=globalThis.__testGitee;');
 assert.doesNotMatch(src,/^import /m);
 return import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
}
const a=await importFunc('functions/api/apps.js'), s=await importFunc('functions/api/settings.js');
const env={};
function req(method,url,body,auth){return new Request(url,{method,headers:{...(auth?{Authorization:'Bearer '+auth}:{}),...((body===undefined)?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});}
let res=await a.onRequest({request:new Request('https://example.com/api/apps',{method:'POST',body:new FormData()}),env});
assert.equal(res.status,403);assert.equal((await res.json()).error,'暂不开放学分申请');assert.deepEqual(readFiles.slice(-1),['data/settings.json']);console.log('PASS server rejects closed new application before parsing FormData');
res=await s.onRequest({request:req('GET','https://example.com/api/settings'),env});
assert.equal((await res.json()).announcementShowConfirm,false);
res=await s.onRequest({request:req('POST','https://example.com/api/settings',{enabled:true,announcementShowConfirm:true},'fake-jwt-system'),env});assert.equal(res.status,200);assert.equal(settings.enabled,true);assert.equal(settings.announcementShowConfirm,true);assert.ok(writes.includes('data/settings.json'));
res=await s.onRequest({request:req('GET','https://example.com/api/settings'),env});assert.equal((await res.json()).announcementShowConfirm,true);
console.log('PASS settings save/read button visibility and application entrance switch');
const guardSource=fs.readFileSync(path.join(root,'assets/route-guard.js'),'utf8');
async function checkGuard(enabled,loggedIn){
 const url=new URL('https://example.com/upload.html');const redirects=[];
 const location={href:url.href,pathname:url.pathname,origin:url.origin,search:'',replace:p=>redirects.push(p),assign:p=>redirects.push(p)};
 const win={location,addEventListener:()=>{},dispatchEvent:()=>{}};
 const doc={documentElement:{style:{},classList:{add(){},remove(){}}},body:{classList:{remove(){}},appendChild(){}},addEventListener:()=>{}};
 const store={studentToken:loggedIn?'token':null,studentUser:loggedIn?JSON.stringify({studentId:'A123'}):null};
 vm.runInNewContext(guardSource,{window:win,document:doc,URL,URLSearchParams,Date,console,setTimeout,clearTimeout,AbortController,
  localStorage:{getItem:k=>store[k]||null},sessionStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},
  fetch:async()=>({ok:true,json:async()=>({enabled,message:'暂停学分申请'})})});
 const target=await win.__routePreflightPromise;await new Promise(r=>setTimeout(r,0));
 if(target)assert.equal(redirects.at(-1),target);else assert.equal(redirects.length,0);
 return target;
}
assert.match(await checkGuard(false,true),/^\/close\.html\?msg=/);
assert.match(await checkGuard(false,false),/^\/close\.html\?msg=/);
assert.equal(await checkGuard(true,false),'/student-login.html?redirect=%2Fupload.html');
assert.equal(await checkGuard(true,true),null); // no redirect when permitted
console.log('PASS frontend route guard: closed, logged out, and open cases');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const ctrl=fs.readFileSync(path.join(root,'assets/controllers/index.mjs'),'utf8');
assert.match(index,/v-if="indexAnnouncementShowConfirm"/);assert.match(index,/class="index-announcement-page service-notice announcement-notice"/);
assert.doesNotMatch(ctrl,/showAlert\?\.\(s\.announcementTitle/);
assert.match(fs.readFileSync(path.join(root,'functions/_middleware.js'),'utf8'),/url\.pathname === '\/api\/settings'/);
console.log('PASS homepage announcement uses notice card and optional confirm action');
