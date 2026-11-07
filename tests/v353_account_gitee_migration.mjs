import assert from 'node:assert/strict';
import {getAccountJson,writeAccountJson} from '../functions/utils/accounts.js';
const env={GITEE_TOKEN:'gitee-secret',GITEE_OWNER:'owner',GITEE_REPO:'repo',GITEE_BRANCH:'main',GITHUB_TOKEN:'legacy-token',GITHUB_OWNER:'old-owner',GITHUB_REPO:'old-repo'};
const files=new Map();let legacyReads=0,giteeWrites=0;
const b64=x=>Buffer.from(JSON.stringify(x),'utf8').toString('base64');
globalThis.fetch=async(input,opts={})=>{
 const u=new URL(input),method=opts.method||'GET';
 if(u.hostname==='gitee.com'){
  const p=u.pathname;
  if(p.endsWith('/contents/data/adminuser.json')){
   if(method==='GET')return files.has('data/adminuser.json')?new Response(JSON.stringify({content:files.get('data/adminuser.json').content,sha:files.get('data/adminuser.json').sha}),{status:200}):new Response('Not found',{status:404});
   if(method==='POST'||method==='PUT'){const body=JSON.parse(opts.body);files.set('data/adminuser.json',{content:body.content,sha:'gitee-sha-'+(++giteeWrites)});return new Response(JSON.stringify({content:{sha:'gitee-sha-'+giteeWrites}}),{status:201});}
  }
  if(p.endsWith('/branches/main'))return new Response('{}',{status:200});
  if(p.endsWith('/repos/owner/repo'))return new Response('{}',{status:200});
  return new Response('Not found',{status:404});
 }
 if(u.hostname==='api.github.com'){
  legacyReads++;
  return new Response(JSON.stringify({content:b64([{username:'system',role:'system',password:'legacy-hash'}]),sha:'old-sha'}),{status:200});
 }
 throw Error('unexpected '+u.href);
};
let result=await getAccountJson(env,'data/adminuser.json');
assert.equal(result.migrated,true);assert.equal(result.content[0].username,'system');assert.equal(giteeWrites,1);assert.equal(legacyReads,1);
result=await getAccountJson(env,'data/adminuser.json');assert.equal(result.migrated,undefined);assert.equal(legacyReads,1);
result.content.push({username:'newadmin',role:'admin'});
await writeAccountJson(env,'data/adminuser.json',result.content,result.sha,'test update');
assert.equal(giteeWrites,2);assert.equal(legacyReads,1);
console.log('PASS legacy admin accounts migrate once from GitHub to Gitee; subsequent reads and writes use Gitee only');
