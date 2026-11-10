const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=require('path').resolve(__dirname,'..');
(async()=>{
const db={'data/students.json':[{studentId:'1',name:'甲'},{studentId:'2',name:'乙'}],'data/adminuser.json':[{username:'admin',auditPermission:1,assignedPermission:true},{username:'reader',auditPermission:0}]};let savedFiles={};
const clone=x=>JSON.parse(JSON.stringify(x));
const ctx={Response,Request,URL,Headers,FormData,Uint8Array,TextDecoder,Date,Math,console,btoa,atob,
getFileFromGitee:async(e,p)=>({content:clone(db[p]||null),sha:'sha'}),getAccountJson:async(e,p)=>({content:clone(db[p]||null)}),writeJsonToGitee:async(e,p,d)=>{db[p]=clone(d)},writeFileToGitee:async(e,p,b)=>{savedFiles[p]=b},requireGiteeConfig:()=>({GITEE_OWNER:'test',GITEE_REPO:'test',GITEE_TOKEN:'secret'}),fetch:async url=>{const name=decodeURIComponent(url.split('/contents/')[1].split('?')[0]);return Response.json({content:savedFiles[name]})}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(root+'/functions/api/requests.js','utf8').replace(/^import .*;$/gm,'').replace('export async function onRequest','async function onRequest'),ctx);
async function call(method,token,body,query=''){const r=await ctx.onRequest({request:new Request('https://example.test/api/requests'+query,{method,headers:{Authorization:'Bearer '+token,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined}),env:{}});return {status:r.status,data:r.headers.get('Content-Type')?.includes('json')?await r.json():await r.text()};}
assert.equal((await call('GET','')).status,401);
assert.equal((await call('GET','fake-jwt-reader')).status,403);assert.equal((await call('POST','fake-jwt-reader',{title:'禁止',studentIds:['1']})).status,403);const safeStudents=(await call('GET','fake-jwt-admin',null,'?scope=students')).data;assert.equal(Object.keys(safeStudents[0]).sort().join(','),'name,studentId');
let r=await call('POST','fake-jwt-admin',{title:'活动',studentIds:['1'],attachmentRequired:true});assert.equal(r.status,201);const taskId=r.data.task.id;
function form(){const f=new FormData();for(const [k,v] of Object.entries({taskId,activityName:'测试活动',location:'教室',activityTime:'2026-11-02T12:00',participants:'甲'}))f.append(k,v);f.append('images',new Blob(['image'],{type:'image/png'}),'证明.png');f.append('attachment',new Blob(['hello']),'材料.txt');return f;}
assert.equal((await call('POST','student-jwt-2',form())).status,403);
assert.equal((await call('POST','student-jwt-1',form())).status,201);
assert.equal((await call('POST','student-jwt-1',form())).status,409);
let task=(await call('GET','student-jwt-1')).data[0];assert.equal(task.submission.status,'pending');
let review={taskId,studentId:'1',submittedAt:task.submission.submittedAt,status:'needs_fix',reason:'补充材料'};
assert.equal((await call('PATCH','student-jwt-1',review)).status,403);assert.equal((await call('PATCH','fake-jwt-reader',review)).status,403);assert.equal((await call('GET','',null,'?scope=published')).data.length,0);
assert.equal((await call('PATCH','fake-jwt-admin',{...review,reason:''})).status,400);
assert.equal((await call('PATCH','fake-jwt-admin',review)).status,200);
task=(await call('GET','student-jwt-1')).data[0];assert.equal(task.submission.status,'needs_fix');assert.equal(task.submission.rejectReason,'补充材料');
db['data/application-requests.json'][0].expiresAt=Date.now()-1000;const correction=new FormData();for(const [k,v] of Object.entries({taskId,activityName:'保留材料重提',location:'新教室',activityTime:'2026-11-02T13:00'}))correction.append(k,v);assert.equal((await call('POST','student-jwt-1',correction)).status,201);assert.equal(db['data/application-requests.json'][0].submissions[0].files.length,2);db['data/application-requests.json'][0].submissions[0].status='needs_fix';
assert.equal((await call('POST','student-jwt-1',form())).status,201);
task=(await call('GET','student-jwt-1')).data[0];assert.equal(task.submission.status,'pending');assert.equal(db['data/application-requests.json'][0].submissions.length,1);
const query='?'+new URLSearchParams({action:'download',taskId,studentId:'1',file:task.submission.files[1].name});
assert.equal((await call('GET','student-jwt-2',null,query)).status,403);
assert.equal((await call('GET','fake-jwt-admin',null,query)).data,'hello');
assert.equal((await call('PATCH','fake-jwt-admin',{...review,submittedAt:0,status:'approved'})).status,409);
assert.equal((await call('PATCH','fake-jwt-admin',{...review,submittedAt:task.submission.submittedAt,status:'approved'})).status,200);
assert.equal((await call('GET','student-jwt-1')).data[0].submission.status,'approved');
const published=(await call('GET','',null,'?scope=published')).data;assert.equal(published.length,1);assert.equal(published[0].submission.studentId,'1');assert.equal(published[0].submission.status,'approved');assert.equal(published[0].submission.files.length,1);assert(published[0].submission.files.every(f=>f.kind.startsWith('image')));const publicQuery='?'+new URLSearchParams({action:'published-image',taskId,studentId:'1',file:task.submission.files[0].name});assert.equal((await call('GET','',null,publicQuery)).data,'image');assert.equal((await call('GET','',null,query.replace('action=download','action=published-image'))).status,403);assert.equal(published[0].studentIds,undefined);
const stored=db['data/application-requests.json'][0];stored.submissions[0].status='pending';stored.studentIds.push('2');assert.equal((await call('PATCH','fake-jwt-admin',{...review,submittedAt:stored.submissions[0].submittedAt,status:'reject',reason:'不符合要求'})).status,200);assert.equal(db['data/application-requests.json'][0].submissions.length,0);assert.deepEqual(db['data/application-requests.json'][0].studentIds,['2']);assert.equal((await call('POST','student-jwt-1',form())).status,403);assert.equal((await call('GET','',null,'?scope=published')).data.length,0);
console.log('PASS public approved feed, audit permission and assigned API: authentication, assignment access, submission, duplicate prevention, review, rejection, expired-task resubmission, stale-review conflict, file authorization and download');
const storage=new Map();let hits=0;const cacheCtx={window:{},Headers,localStorage:{getItem:()=>''},sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k),key:i=>[...storage.keys()][i],get length(){return storage.size}},fetch:async()=>{hits++;return Response.json({hit:hits})}};
vm.createContext(cacheCtx);vm.runInContext(fs.readFileSync(root+'/api-cache.js','utf8'),cacheCtx);const cache=cacheCtx.window.apiCache;
await Promise.all([cache.get('/api/test'),cache.get('/api/test')]);assert.equal(hits,1);await cache.get('/api/test');assert.equal(hits,1);await cache.get('/api/test',{fetchOpts:{headers:{Authorization:'Bearer other'}}});assert.equal(hits,2);cache.invalidate('/api/test');await cache.get('/api/test');assert.equal(hits,3);await cache.get('/api/test',{force:true});assert.equal(hits,4);await cache.get('/api/test',{ttl:0});assert.equal(hits,5);
console.log('PASS cache: concurrent deduplication, reuse, account isolation, invalidation, force refresh and ttl=0');
})().catch(e=>{console.error(e);process.exitCode=1});
