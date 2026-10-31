import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const utilSource = fs.readFileSync(path.join(root, 'functions/utils/gitee.js'), 'utf8');
const util = await import('data:text/javascript;base64,' + Buffer.from(utilSource).toString('base64'));
const env = {GITEE_TOKEN:'dummy', GITEE_OWNER:'team', GITEE_REPO:'credits', GITEE_BRANCH:'main'};
let calls=[];
globalThis.fetch=async (input, opts={}) => {
  calls.push({url:String(input),opts});
  if(String(input).includes('/contents/data/app.json')) return new Response(JSON.stringify({content:btoa('[{"id":123}]'),sha:'rev01'}),{status:200});
  return new Response('unknown',{status:404});
};
await assert.rejects(()=>util.getFileFromGitee({},'data/app.json'),e=>e.code==='GITEE_CONFIG_MISSING' && e.missing.length===3);
await assert.rejects(()=>util.writeJsonToGitee({},'data/settings.json',{}),e=>e.code==='GITEE_CONFIG_MISSING');
assert.equal(calls.length,0,'never fetch with undefined token');
const loaded=await util.getFileFromGitee(env,'data/app.json');assert.deepEqual(loaded.content,[{id:123}]);
assert.equal(calls.length,1);assert.match(calls[0].url,/ref=main/);assert.equal(calls[0].opts.headers.Authorization,'token dummy');
console.log('PASS Gitee configured read and missing config checks');
// Wrong repository / branch must not masquerade as an empty app list.
for(const [repoCode,branchCode,message] of [[404,200,'Gitee 仓库不可访问'],[200,404,'Gitee 分支不可访问']]){
  globalThis.fetch=async (input)=>{const url=String(input);if(url.includes('/contents/'))return new Response('',{status:404});if(url.includes('/branches/'))return new Response('',{status:branchCode});return new Response('',{status:repoCode});};
  await assert.rejects(()=>util.getFileFromGitee(env,'data/app.json'),e=>e.message.includes(message));
}
globalThis.fetch=async(input)=>{const url=String(input);if(url.includes('/contents/'))return new Response('',{status:404});return new Response('{}',{status:200});};
assert.equal((await util.getFileFromGitee(env,'data/messages.json')).content,null);
console.log('PASS repository/branch diagnosis vs genuinely missing file');
// Mock shared Gitee helper in settings and apps modules.
let state={enabled:false, announcementShowConfirm:false, message:'关闭中'};
let behavior='missing', writeCount=0;
const mock={
  getFileFromGitee:async()=>{ if(behavior==='missing'){const e=new Error('Cloudflare Pages 未配置 Gitee 环境变量：GITEE_TOKEN');e.code='GITEE_CONFIG_MISSING';e.missing=['GITEE_TOKEN'];throw e;}if(behavior==='network')throw Error('Gitee upstream error'); return {content:state,sha:'sha'};},
  writeJsonToGitee:async (_env,_path,data)=>{writeCount++; state=data;},
  writeFileToGitee:async()=>{}
};
globalThis.__v346GiteeMock=mock;
async function loadApi(name){
  const s=fs.readFileSync(path.join(root,'functions/api/'+name+'.js'),'utf8').replace(/^import \{[^\n]+\} from '\.\.\/utils\/gitee';/m, 'const {getFileFromGitee,writeJsonToGitee,writeFileToGitee}=globalThis.__v346GiteeMock;');
  assert.doesNotMatch(s,/^import /m);
  return import('data:text/javascript;base64,'+Buffer.from(s).toString('base64'));
}
const settings=await loadApi('settings'), apps=await loadApi('apps');
const originalError=console.error; console.error=()=>{};
const req=(method, url, body, auth) => new Request('https://example.com/api/'+url,{method,headers:{...(auth?{Authorization:'Bearer fake-jwt-system'}:{})},body});
let response=await settings.onRequest({request:req('GET','settings'),env:{}}),json=await response.json();
assert.equal(response.status,503);assert.equal(json.code,'GITEE_CONFIG_MISSING');assert.deepEqual(json.missing,['GITEE_TOKEN']);assert.equal(json.enabled,undefined);
response=await apps.onRequest({request:req('GET','apps'),env:{}});assert.equal(response.status,503);assert.equal((await response.json()).code,'GITEE_CONFIG_MISSING');
response=await settings.onRequest({request:req('POST','settings',JSON.stringify({enabled:true}),true),env:{}});assert.equal(response.status,503);assert.equal(writeCount,0);
behavior='network';response=await settings.onRequest({request:req('GET','settings'),env:{}});assert.equal(response.status,502);assert.equal((await response.json()).enabled,undefined);
response=await settings.onRequest({request:req('POST','settings',JSON.stringify({enabled:true}),true),env:{}});assert.equal(response.status,502);assert.equal(writeCount,0);
console.log('PASS no silent enabled=true on Gitee failure, no unsafe overwrite');
behavior='healthy';response=await settings.onRequest({request:req('GET','settings'),env:{}});assert.equal(response.status,200);assert.equal((await response.json()).enabled,false);
response=await settings.onRequest({request:req('POST','settings',JSON.stringify({enabled:true,announcementShowConfirm:true}),true),env:{}});assert.equal(response.status,200);assert.equal(writeCount,1);assert.equal(state.enabled,true);
console.error=originalError;
console.log('PASS configured settings read/write compatibility');
