import { getFileFromGitee, writeJsonToGitee } from '../utils/gitee';

const datasets = [
  ['app','普通学分申请'],['application-requests','指定学分申请'],['file-tasks','文件任务'],
  ['uploads','文件提交记录'],['messages','站内消息'],['students','学生账户'],
  ['adminuser','管理员账户'],['account-sessions','登录会话与风控'],['loginlog','登录审计'],
  ['settings','系统设置'],['about','关于页面'],['music-library','音乐库']
];
const terminal = new Set(['deleted','cancelled','canceled','withdrawn']);
const sessionRetention = 30*86400000;

function redundantRows(key,rows,now) {
  if(key==='app')return rows.filter(row=>row && terminal.has(row.status));
  // Generated notifications are deduplicated by ID. Preserve their deletion markers.
  if(key==='messages')return rows.filter(row=>row?.deleted===true && !row.sentBy && (row.type !== 'system' || row.appId) && /^msg_\d+_/.test(row.id||''));
  if(key==='account-sessions'){
    const last=new Map();
    for(const row of rows){
      if(!row?.token)continue;
      const id=JSON.stringify([row.kind,row.id]);
      if(!last.has(id)||last.get(id).loginAt<=row.loginAt)last.set(id,row);
    }
    const keep=new Set(last.values());
    return rows.filter(row=>row?.token && ['student','admin'].includes(row.kind) &&
      Number.isFinite(row.expiresAt) && row.expiresAt<=now-sessionRetention && !keep.has(row));
  }
  return [];
}

async function inspect(env,key,label,now){
  const path='data/'+key+'.json';
  const file=await getFileFromGitee(env,path);
  const rows=Array.isArray(file.content)?file.content:null;
  const redundant=rows?redundantRows(key,rows,now):[];
  return {path,file,rows,redundant,summary:{
    key,label,revision:file.sha||null,total:rows?.length??(file.content?1:0),
    count:redundant.length,bytes:redundant.length?new Blob([JSON.stringify(redundant)]).size:0
  }};
}

export async function onRequest({request,env,data}) {
  const session=data?.accountSession;
  if(session?.state!=='online'||session.account?.role!=='system'){
    return Response.json({error:'需要 system 权限'},{status:403});
  }
  const action=new URL(request.url).searchParams.get('action');
  const now=Date.now();
  if(request.method==='GET'&&action==='scan'){
    const entries=await Promise.all(datasets.map(async ([key,label])=>{
      try{return (await inspect(env,key,label,now)).summary;}
      catch{return {key,label,error:'读取失败，已跳过'};}
    }));
    return Response.json({entries,scannedAt:now,count:entries.reduce((sum,row)=>sum+(row.count||0),0),
      sizeBytes:entries.reduce((sum,row)=>sum+(row.bytes||0),0)},{headers:{'Cache-Control':'no-store'}});
  }
  if(request.method==='POST'&&action==='clean'){
    const body=await request.json().catch(()=>null);
    const selected=new Map(Array.isArray(body?.entries)?body.entries.filter(row=>row&&typeof row.key==='string').map(row=>[row.key,row.revision]):[]);
    if(!selected.size||!Number.isSafeInteger(body.scannedAt)||body.scannedAt>now||now-body.scannedAt>10*60000){
      return Response.json({error:'请重新扫描可清理数据'},{status:400});
    }
    let removed=0;
    const skipped=[];
    for(const [key,label] of datasets){
      if(!selected.has(key))continue;
      try{
        const scan=await inspect(env,key,label,body.scannedAt);
        if(!scan.file.sha||scan.file.sha!==selected.get(key)){skipped.push(label);continue;}
        if(!scan.redundant.length)continue;
        const discard=new Set(scan.redundant);
        await writeJsonToGitee(env,scan.path,scan.rows.filter(row=>!discard.has(row)),scan.file.sha,'clean redundant '+key);
        removed+=discard.size;
      }catch{skipped.push(label);}
    }
    return Response.json({removed,skipped,message:'已清理 '+removed+' 条冗余数据'+(skipped.length?'，以下范围有更新或读取失败，请重新扫描：'+skipped.join('、'):'')});
  }
  return new Response('Method not allowed',{status:405});
}
