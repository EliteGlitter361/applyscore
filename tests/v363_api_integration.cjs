const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const admins=[{username:'system',role:'system'},{username:'admin',role:'admin'}],students=[{name:'李同学',studentId:'0001',password:'abc'},{name:'王同学',studentId:'0002',password:'def'}];
const store={'data/students.json':students,'data/application-requests.json':[]}, uploads={};
let sha=0;
const deps={
 getAccountJson:async(env,p)=>({content:structuredClone(p==='data/adminuser.json'?admins:[]),sha:'v'+sha}),
 getFileFromGitee:async(env,p)=>({content:structuredClone(store[p]??null),sha:'v'+sha}),
 writeJsonToGitee:async(env,p,data,oldSha)=>{if(oldSha&&oldSha!=='v'+sha)throw Error('sha conflict');store[p]=structuredClone(data);sha++;return {}},
 writeFileToGitee:async(env,p,b64)=>{uploads[p]=b64;return{}},
 console, Response,Request,FormData,File,Blob,Date,Math,btoa,Uint8Array,Error,String,Array,Number,JSON
};
const source=fs.readFileSync(path.join(root,'functions/api/requests.js'),'utf8').replace(/^import\s+.*?;\s*$/gm,'').replace('export async function onRequest','async function onRequest')+'\nthis.handler=onRequest;';
const ctx=vm.createContext(deps);vm.runInContext(source,ctx,{filename:'requests.js'});
const req=(method,token,body)=>new Request('https://test.example/api/requests',{method,headers:token?{Authorization:'Bearer '+token}:undefined,body:body?body instanceof FormData?body:JSON.stringify(body):undefined});
const call=async (method,token,body)=>{const response=await ctx.handler({request:req(method,token,body),env:{}});return [response.status,await response.json()]};
(async()=>{
 let [status,result]=await call('GET','unauthorized');assert.equal(status,401);
 [status,result]=await call('POST','fake-jwt-system',{title:'志愿活动',studentIds:['0001'],attachmentRequired:true,expiryMode:'duration',durationValue:7});assert.equal(status,201,JSON.stringify(result));
 const task=result.task;assert.equal(store['data/application-requests.json'].length,1);assert(task.expiresAt>Date.now());
 [status,result]=await call('GET','fake-jwt-system');assert.equal(status,200);assert.equal(result.length,1);assert(Array.isArray(result[0].submissions));
 [status,result]=await call('GET','student-jwt-0002');assert.equal(status,200);assert.equal(result.length,0);
 [status,result]=await call('GET','student-jwt-0001');assert.equal(result.length,1);assert.equal(result[0].studentIds,undefined);assert.equal(result[0].submissions,undefined);assert(!result[0].submitted);
 const form=new FormData();form.append('taskId',task.id);form.append('activityName','校园活动');form.append('location','操场');form.append('activityTime','2026-11-01T15:00');
 [status,result]=await call('POST','student-jwt-0001',form);assert.equal(status,400);assert.match(result.error,/图片/);
 form.append('images',new File([new Uint8Array([137,80,78,71])],'proof.png',{type:'image/png'}));
 [status,result]=await call('POST','student-jwt-0001',form);assert.equal(status,400);assert.match(result.error,/附件/);
 form.append('attachment',new File(['log'],'evidence.txt',{type:'text/plain'}));
 [status,result]=await call('POST','student-jwt-0001',form);assert.equal(status,201,JSON.stringify(result));assert.equal(Object.keys(uploads).length,2);
 [status,result]=await call('GET','student-jwt-0001');assert.equal(status,200);assert(result[0].submitted);assert.equal(result[0].submission.files.length,2);
 [status,result]=await call('POST','student-jwt-0001',form);assert.equal(status,409);
 store['data/application-requests.json'][0].expiresAt=Date.now()-2000;
 [status,result]=await call('POST','student-jwt-0001',form);assert.equal(status,410);
 [status,result]=await call('POST','fake-jwt-system',{title:'无效',studentIds:['NOPE'],expiryMode:'none'});assert.equal(status,400);
 console.log('PASS API integration: admin create, per-student visibility, required image/attachment, Gitee uploads, duplicate/expiration/unknown student rejection');
})().catch(err=>{console.error(err);process.exitCode=1});
