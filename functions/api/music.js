/** Shared MP3 library on Gitee; writes require a fresh system HMAC credential. */
import {getFileFromGitee, writeFileToGitee, writeJsonToGitee} from '../utils/gitee.js';
import {verifyAboutSession} from '../utils/about-session.js';
import {getJsonFromGithub} from '../utils/github.js';
export const INDEX_PATH='data/music-library.json';
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
export const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
export async function authorized(request,env){
  const token=/^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization')||'')?.[1];
  const signed=await verifyAboutSession(env,token);
  if (!signed) return false;
  const {content}=await getJsonFromGithub(env,'data/adminuser.json');
  return Array.isArray(content) && content.some(u=>u.username===signed.username && u.role==='system');
}
export async function readLibrary(env){
  const {content,sha}=await getFileFromGitee(env,INDEX_PATH);
  if (content!=null && !Array.isArray(content)) throw new Error('音乐库索引格式错误');
  return {tracks:(content||[]).filter(t=>t && /^[a-f0-9-]{8,64}$/i.test(t.id)).map(t=>({id:String(t.id),name:String(t.name||'未命名曲目'),size:Number(t.size)||0,createdAt:String(t.createdAt||'')})),sha};
}
export async function onRequest({request,env}){
  if (request.method==='GET'){
    try {const {tracks}=await readLibrary(env);return json({tracks});}
    catch(e){console.error('[music list]',e);return json({error:'音乐库暂时无法读取'},503);}
  }
  if(request.method!=='POST') return json({error:'Method not allowed'},405);
  try{
    if(!await authorized(request,env))return json({error:'仅 system 账户可上传音乐，请重新登录'},403);
    const form=await request.formData();const file=form.get('file');
    if(!file || typeof file.arrayBuffer!=='function')return json({error:'请选择 MP3 文件'},400);
    const name=String(file.name||'').trim();
    if(!/\.mp3$/i.test(name))return json({error:'只能上传 .mp3 音频文件'},400);
    if(!file.size || file.size>12*1024*1024)return json({error:'MP3 单文件必须大于 0 且不超过 12MB'},413);
    const {tracks,sha}=await readLibrary(env);
    if(tracks.length>=300)return json({error:'音乐库最多存储 300 首曲目'},400);
    const bytes=new Uint8Array(await file.arrayBuffer());
    // Most MP3s start with ID3 metadata or MPEG frame sync.
    if(!(bytes[0]===73 && bytes[1]===68 && bytes[2]===51) && !(bytes[0]===255 && (bytes[1]&224)===224))return json({error:'该文件不像有效的 MP3 音频'},400);
    let binary='';for(let p=0;p<bytes.length;p+=0x8000)binary+=String.fromCharCode(...bytes.subarray(p,p+0x8000));
    const id=crypto.randomUUID();
    const safeName=name.replace(/[\\/\x00-\x1f]/g,'_').slice(0,140);
    await writeFileToGitee(env,`data/music/${id}.mp3`,btoa(binary),null,`upload music ${safeName}`);
    const track={id,name:safeName,size:file.size,createdAt:new Date().toISOString()};
    try {await writeJsonToGitee(env,INDEX_PATH,[...tracks,track],sha,`add music ${safeName}`);}
    catch(error){console.error('[music index save after media upload]',error);return json({error:'音频已上传，但更新曲库清单失败。请勿立即重复上传，请管理员检查数据。'},502);}
    return json({track},201);
  }catch(e){console.error('[music upload]',e);return json({error:'上传失败：'+(e.message||'服务器错误')},502);}
}
