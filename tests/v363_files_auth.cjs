const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const root=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(root,'functions/api/files.js'),'utf8').replace(/^import\s+.*?;\s*$/gm,'').replace('export async function onRequest','async function onRequest')+'\nthis.handler=onRequest;';
const mock={Response,Request,Array,Date,Uint8Array,JSON,console,btoa,Error,
 getAccountJson:async()=>({content:[{username:'system',role:'system'}]}),
 getFileFromGitee:async()=>({content:[{id:'u1',name:'小王',studentId:'0001'}],sha:'abc'}),
 writeJsonToGitee:async()=>({}),writeFileToGitee:async()=>({})};
vm.createContext(mock);vm.runInContext(src,mock);
async function get(token){const r=await mock.handler({request:new Request('https://test.test/api/files',{headers:token?{Authorization:'Bearer '+token}:{}}),env:{}});return [r.status,await r.json()]}
(async()=>{
 let [status]=await get();assert.equal(status,401);
 [status]=await get('fake-jwt-outsider');assert.equal(status,403);
 let data;[status,data]=await get('fake-jwt-system');assert.equal(status,200);assert.equal(data[0].studentId,'0001');
 console.log('PASS /api/files GET rejects anonymous and unknown admin, permits existing administrator');
})().catch(e=>{console.error(e);process.exitCode=1});
