import {getRawFileContentFromGitee,writeJsonToGitee} from '../../utils/gitee.js';
import {authorized,readLibrary,INDEX_PATH,json} from '../music.js';
function safeId(id){return /^[a-f0-9-]{8,64}$/i.test(id||'') ? id : null;}
export async function onRequest({request,env,params,context}){
  const id=safeId(params.id);if(!id)return json({error:'无效的曲目编号'},400);
  if(request.method==='DELETE'){
    try {
      if(!await authorized(request,env))return json({error:'仅 system 账户可以删除曲目'},403);
      const {tracks,sha}=await readLibrary(env);
      if(!tracks.some(t=>t.id===id))return json({error:'曲目不存在'},404);
      // Gitee file delete first. A failed index update is explicitly reported.
      const {GITEE_OWNER,GITEE_REPO,GITEE_TOKEN,GITEE_BRANCH='master'}=env;
      const filePath=`data/music/${id}.mp3`;
      const source=await fetch(`https://gitee.com/api/v5/repos/${encodeURIComponent(GITEE_OWNER)}/${encodeURIComponent(GITEE_REPO)}/contents/${filePath}?ref=${encodeURIComponent(GITEE_BRANCH)}`,{headers:{Authorization:`token ${GITEE_TOKEN}`,Accept:'application/json'}});
      if(source.ok){const old=await source.json();const deletion=await fetch(`https://gitee.com/api/v5/repos/${encodeURIComponent(GITEE_OWNER)}/${encodeURIComponent(GITEE_REPO)}/contents/${filePath}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({access_token:GITEE_TOKEN,sha:old.sha,branch:GITEE_BRANCH,message:'remove music '+id})});if(!deletion.ok)throw Error('Gitee 删除音频失败（'+deletion.status+'）');}
      else if(source.status!==404)throw Error('无法检查曲目文件（'+source.status+'）');
      await writeJsonToGitee(env,INDEX_PATH,tracks.filter(t=>t.id!==id),sha,'remove music '+id);
      // Best-effort removal of the immutable MP3 cache entry in this edge location.
      try {await caches.default.delete(new Request(new URL('/api/music/'+id,request.url).toString()));} catch (_) {}
      return json({ok:true});
    }catch(e){console.error('[music delete]',e);return json({error:'删除失败：'+(e.message||'服务器错误')},502);}
  }
  if(!['GET','HEAD'].includes(request.method))return json({error:'Method not allowed'},405);
  try{
    // Track IDs are immutable UUIDs. Reading the index from Gitee on *every* Range
    // request doubles latency, so GET/HEAD fetch the verified UUID directly.
    // A deleted track remains absent from the public index and this endpoint's
    // edge cache is purged best-effort on deletion.
    const url=new URL('/api/music/'+id,request.url).toString();
    const cacheRequest=new Request(url,{method:'GET'});
    const edgeCache=typeof caches!=='undefined'&&caches.default ? caches.default : null;
    let audio=edgeCache ? await edgeCache.match(cacheRequest) : null;
    if(!audio){
      const base64=await getRawFileContentFromGitee(env,`data/music/${id}.mp3`);
      const raw=atob(base64.replace(/\s/g,''));
      const bytes=new Uint8Array(raw.length);
      for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
      audio=new Response(bytes,{status:200,headers:{
        'Content-Type':'audio/mpeg','Content-Length':String(bytes.length),
        'Cache-Control':'public, max-age=86400, immutable',
        'Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff'
      }});
      if(edgeCache){
        const persist=edgeCache.put(cacheRequest,audio.clone()).catch(()=>{});
        // Cache in the background: do not delay the first audio byte to persist at edge.
        if(context?.waitUntil)context.waitUntil(persist);
        else await persist;
      }
    }
    const bytes=new Uint8Array(await audio.arrayBuffer());
    const length=bytes.length;
    const range=request.headers.get('Range');let start=0,end=length-1,status=200;
    if(range){
      const match=/^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if(!match || (!match[1]&&!match[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${length}`}});
      if(match[1]){start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),length-1):length-1;}
      else{const suffix=Number(match[2]);start=Math.max(0,length-suffix);}
      if(start>=length||start>end)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${length}`}});
      status=206;
    }
    const headers={
      'Content-Type':'audio/mpeg','Accept-Ranges':'bytes',
      'Content-Length':String(status===206?end-start+1:length),
      'Cache-Control':'public, max-age=86400, immutable',
      'X-Content-Type-Options':'nosniff'
    };
    if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${length}`;
    return new Response(request.method==='HEAD'?null:bytes.subarray(start,end+1),{status,headers});
  }catch(error){
    console.error('[music play]',error);
    return json({error:'音频暂时无法播放'},502);
  }
}
