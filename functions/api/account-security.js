import {readAccounts,accountId,changeSessions,setBan,findAccount,loginPolicy,deviceLabel,accountRisk} from '../utils/account-sessions.js';

export async function onRequest({request,env,data}){
  const session=data.accountSession;
  if(!session)return Response.json({state:'revoked',error:'登录已失效'},{status:401});
  const {row,account,state}=session;
  const action=new URL(request.url).searchParams.get('action');
  if((action==='heartbeat'&&request.method==='GET')||(action==='away'&&request.method==='POST')){
    const query=new URL(request.url).searchParams;
    const view=query.get('view')||'',seq=Number(query.get('seq'));
    const validView=/^[a-z0-9-]{20,80}$/i.test(view)&&Number.isSafeInteger(seq)&&seq>0;
    if(state==='online'&&validView){
      const away=action==='away';
      const now=Date.now(),previous=row.views?.find(item=>item.id===view);
      if(!previous||previous.away!==away||(!away&&now-previous.at>=12000)){
        await changeSessions(env,rows=>{
          const current=rows.find(item=>item.token===row.token&&!item.revoked);
          if(!current)return false;
          const views=current.views||[];
          const prior=views.find(item=>item.id===view);
          if(prior&&prior.seq>=seq)return false;
          current.views=[...views.filter(item=>item.id!==view&&now-item.at<60000),{id:view,seq,away,at:now}].slice(-20);
          if(!away)current.seenAt=now;
          return true;
        }).catch(()=>{});
      }
    }else if(state==='online'&&action==='heartbeat'&&!row.views&&Date.now()-row.seenAt>=12000){
      await changeSessions(env,rows=>{
        const current=rows.find(item=>item.token===row.token&&!item.revoked&&!item.views);
        if(!current)return false;
        current.seenAt=Date.now();return true;
      }).catch(()=>{});
    }
    return Response.json({state,kind:row?.kind});
  }
  if(action==='logout'&&request.method==='POST'){
    if(state==='online'){
      try{
        await changeSessions(env,rows=>{
          const current=rows.find(x=>x.token===row.token&&!x.revoked);
          if(!current)return false;
          current.revoked=true;
          return true;
        });
      }catch{return Response.json({error:'退出状态暂时无法更新'},{status:503});}
    }
    return Response.json({state:'revoked'});
  }
  if(state!=='online'||account.role!=='system')return Response.json({error:'需要 system 权限'},{status:403});
  try{
    if(request.method==='GET'){
      const students=await readAccounts(env,'student');
      const records=session.records,now=Date.now();
      const rows=[['student',students.content],['admin',session.accounts]].flatMap(([kind,list])=>(list||[]).filter(x=>x.role!=='system').map(x=>{
        const id=accountId(kind,x);
        const sessions=records.filter(r=>r.kind===kind&&r.id===id);
        const latest=sessions.at(-1);
        const active=sessions.filter(r=>!x.banned&&!r.revoked&&r.expiresAt>now&&(r.views?r.views.some(v=>!v.away&&now-v.at<30000):now-r.seenAt<30000));
        const devices=[...new Set(active.map(r=>deviceLabel(r.device)))];
        return {id,kind,name:x.name||x.username||id,banned:!!x.banned,online:active.length>0,onlineCount:active.length,risk:accountRisk(records,kind,id,active.length,now),loginAt:latest?.loginAt||null,device:devices.join('、')||(latest?deviceLabel(latest.device):'')};
      }));
      return Response.json({rows,policy:loginPolicy(records)});
    }
    if(request.method==='POST'){
      const {kind,id,operation,mode}=await request.json();
      if(operation==='policy'){
        if(!['student','admin'].includes(kind)||!['single','multiple'].includes(mode))return Response.json({error:'登录设备策略无效'},{status:400});
        await changeSessions(env,rows=>{
          let settings=rows.find(x=>x.kind==='policy');
          if(!settings){settings={kind:'policy',modes:loginPolicy(rows)};rows.push(settings);}
          settings.modes={...loginPolicy(rows),[kind]:mode};
          if(mode==='single'){
            const kept=new Set();
            for(const item of [...rows].reverse()){
              if(item.kind!==kind||item.revoked||item.expiresAt<=Date.now())continue;
              if(kept.has(item.id))item.revoked=true;
              else kept.add(item.id);
            }
          }
          return true;
        });
        return Response.json({message:'登录设备策略已保存'});
      }
      if(!['student','admin'].includes(kind)||typeof id!=='string'||!id||!['kick','ban','unban'].includes(operation)||(kind==='admin'&&id===row.id))return Response.json({error:'账户或操作无效'},{status:400});
      if(operation==='ban'){
        if(!await setBan(env,kind,id,true))return Response.json({error:'账户不存在或不可操作'},{status:404});
        return Response.json({message:'已封禁账户'});
      }
      const target=findAccount((await readAccounts(env,kind)).content,kind,id);
      if(!target||target.role==='system')return Response.json({error:'账户不存在或不可操作'},{status:404});
      // Revoke before lifting a ban so it cannot restore an old login.
      await changeSessions(env,rows=>{
        let changed=false;
        for(const item of rows)if(item.kind===kind&&item.id===id&&!item.revoked){item.revoked=true;changed=true;}
        return changed;
      });
      if(operation!=='kick'&&!await setBan(env,kind,id,operation==='ban'))return Response.json({error:'账户不存在或不可操作'},{status:404});
      return Response.json({message:operation==='kick'?'已强制下线':operation==='ban'?'已封禁账户':'已解除封禁'});
    }
    return new Response(null,{status:405});
  }catch{return Response.json({error:'账户状态暂时无法更新，请重试'},{status:503});}
}
