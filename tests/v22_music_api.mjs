import assert from 'node:assert/strict';
import {makeAboutSession} from '../functions/utils/about-session.js';
import {onRequest as library} from '../functions/api/music.js';
import {onRequest as trackRoute} from '../functions/api/music/[id].js';
const env={GITEE_TOKEN:'test-gitee-token-long-enough',GITEE_OWNER:'owner',GITEE_REPO:'repo',GITEE_BRANCH:'master',GITHUB_TOKEN:'gh-token',GITHUB_OWNER:'owner',GITHUB_REPO:'repo'};
const files=new Map();let version=1;
function ghContent(value){return Buffer.from(JSON.stringify(value),'utf8').toString('base64');}
globalThis.fetch=async(url,opts={})=>{
 const u=new URL(url),method=opts.method||'GET';
 if(u.hostname==='api.github.com')return new Response(JSON.stringify({content:ghContent([{username:'system',role:'system'},{username:'admin',role:'admin'}]),sha:'github'}),{status:200});
 if(u.hostname==='gitee.com'){
  const path=decodeURIComponent(u.pathname.split('/contents/')[1]||'');
  if(method==='GET'){const entry=files.get(path);return entry?new Response(JSON.stringify({content:entry.content,sha:entry.sha}),{status:200}):new Response('{}',{status:404});}
  const body=JSON.parse(opts.body||'{}');
  if(method==='DELETE'){files.delete(path);return new Response(JSON.stringify({ok:true}),{status:200});}
  if(method==='POST'||method==='PUT'){
   if(method==='PUT'&&body.sha!==files.get(path)?.sha)return new Response('sha collision',{status:409});
   files.set(path,{content:body.content,sha:'s'+version++});return new Response(JSON.stringify({ok:true}),{status:200});
  }
 }
 throw Error('unexpected URL '+url);
};
const token=await makeAboutSession(env,{username:'system',role:'system'});
const form=new FormData();form.set('file',new File([Uint8Array.from([73,68,51,3,0,0,0,0,0,0,0,1,2,3])],'测试 音乐.mp3',{type:'audio/mpeg'}));
let res=await library({request:new Request('https://site.test/api/music',{method:'POST',body:form,headers:{Authorization:'Bearer '+token}}),env});assert.equal(res.status,201,await res.clone().text());
const created=await res.json();assert.ok(created.track.id);
res=await library({request:new Request('https://site.test/api/music'),env});assert.equal(res.status,200);assert.equal((await res.json()).tracks.length,1);
res=await trackRoute({request:new Request('https://site.test/api/music/'+created.track.id,{headers:{Range:'bytes=1-4'}}),params:{id:created.track.id},env});assert.equal(res.status,206);assert.equal(res.headers.get('Content-Range'),'bytes 1-4/14');assert.deepEqual(new Uint8Array(await res.arrayBuffer()),Uint8Array.from([68,51,3,0]));
const other=await makeAboutSession(env,{username:'system',role:'system'}); // same signer, no plain-string bypass
res=await trackRoute({request:new Request('https://site.test/api/music/'+created.track.id,{method:'DELETE',headers:{Authorization:'Bearer invalid'}}),params:{id:created.track.id},env});assert.equal(res.status,403);
res=await library({request:new Request('https://site.test/api/music',{method:'POST',body:form,headers:{Authorization:'Bearer fake-jwt-system'}}),env});assert.equal(res.status,403);
res=await trackRoute({request:new Request('https://site.test/api/music/'+created.track.id,{method:'DELETE',headers:{Authorization:'Bearer '+token}}),params:{id:created.track.id},env});assert.equal(res.status,200,await res.clone().text());
res=await library({request:new Request('https://site.test/api/music'),env});assert.deepEqual((await res.json()).tracks,[]);
console.log('PASS music Gitee CRUD, byte-range, signed authorization and invalid token');
