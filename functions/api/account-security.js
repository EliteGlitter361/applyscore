import {effectiveAdminPermissions} from '../utils/accounts.js';
import {readAccounts,accountId,changeSessions,setBan,findAccount,loginPolicy,deviceLabel,accountRisk,riskRules,timedBan,clearTimedBan,maxDeviceWindowHours,cleanBanReason,setTimedBan,validManualBanUntil,requiresInitialSystemToUnban} from '../utils/account-sessions.js';

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
    return Response.json({state,kind:row?.kind,banReason:session.banReason,banUntil:session.banUntil});
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
  const isInitialSystem = effectiveAdminPermissions(account,session.accounts).isInitialSystem;
  try{
    if(request.method==='GET'){
      const students=await readAccounts(env,'student');
      const records=session.records,now=Date.now();
      const rows=[['student',students.content],['admin',session.accounts]].flatMap(([kind,list])=>(list||[]).filter(x=>x.role!=='system').map(x=>{
        const id=accountId(kind,x);
        const sessions=records.filter(r=>r.kind===kind&&r.id===id);
        const latest=sessions.at(-1);
        const ban=timedBan(records,kind,id,now);
        const active=sessions.filter(r=>!x.banned&&!ban&&!r.revoked&&r.expiresAt>now&&(r.views?r.views.some(v=>!v.away&&now-v.at<30000):now-r.seenAt<30000));
        const devices=[...new Set(active.map(r=>deviceLabel(r.device)))];
        return {id,kind,name:x.name||x.username||id,banned:!!x.banned||!!ban,banUntil:x.banned?null:ban?.until,canUnban:!requiresInitialSystemToUnban(ban,x.banned)||isInitialSystem,banReason:x.banned?x.banReason:ban?.reason,online:active.length>0,onlineCount:active.length,risk:accountRisk(records,kind,id,active.length,now),loginAt:latest?.loginAt||null,device:devices.join('、')||(latest?deviceLabel(latest.device):'')};
      }));
      return Response.json({rows,policy:loginPolicy(records),riskRules:effectiveAdminPermissions(account,session.accounts).canManageRiskRules ? riskRules(records) : null});
    }
    if(request.method==='POST'){
      const {kind,id,operation,mode,rules,reason,days,banUntil}=await request.json();
      if(operation==='risk-policy'){
        if (!effectiveAdminPermissions(account,session.accounts).canManageRiskRules) {
          return Response.json({error:'需要初始化 system 授予风控设置权限'},{status:403});
        }
        const valid=(rule,limit,min,max)=>typeof rule?.enabled==='boolean'&&Number.isInteger(rule.days)&&rule.days>=1&&rule.days<=365&&
          (!limit||(Number.isInteger(rule.limit)&&rule.limit>=min&&rule.limit<=max));
        const validWindow=rule=>Number.isInteger(rule?.windowHours)&&rule.windowHours>=1&&rule.windowHours<=maxDeviceWindowHours;
        if(!valid(rules?.submission,true,1,120)||!valid(rules?.loginFailures,true,1,20)||!valid(rules?.loginFrequency,true,1,120)||!valid(rules?.deviceCount,true,2,20)||
           !validWindow(rules?.deviceCount)||!valid(rules?.applicationWithdrawals,true,1,120)||!valid(rules?.applicationRevisions,true,1,120)){
          return Response.json({error:'风控参数无效，请检查次数、设备数、时间窗口和封禁天数'},{status:400});
        }
        if(typeof rules.includeAdmin!=='boolean')return Response.json({error:'风控作用域无效'},{status:400});
        const clean={includeAdmin:rules.includeAdmin,submission:{enabled:rules.submission.enabled,limit:rules.submission.limit,days:rules.submission.days},
          loginFailures:{enabled:rules.loginFailures.enabled,limit:rules.loginFailures.limit,days:rules.loginFailures.days},
          loginFrequency:{enabled:rules.loginFrequency.enabled,limit:rules.loginFrequency.limit,days:rules.loginFrequency.days},
          applicationWithdrawals:{enabled:rules.applicationWithdrawals.enabled,limit:rules.applicationWithdrawals.limit,days:rules.applicationWithdrawals.days},
          applicationRevisions:{enabled:rules.applicationRevisions.enabled,limit:rules.applicationRevisions.limit,days:rules.applicationRevisions.days},
          deviceCount:{enabled:rules.deviceCount.enabled,limit:rules.deviceCount.limit,days:rules.deviceCount.days,windowHours:rules.deviceCount.windowHours}};
        await changeSessions(env,rows=>{
          const existing=rows.find(item=>item.kind==='risk-policy');
          if(existing)existing.rules=clean;
          else rows.push({kind:'risk-policy',rules:clean});
          return true;
        });
        return Response.json({message:'账户风控已保存'});
      }
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
        if(!effectiveAdminPermissions(account,session.accounts).canBan)return Response.json({error:'没有封禁权限'},{status:403});
        const banReason=cleanBanReason(reason);
        if(!banReason)return Response.json({error:'请填写 1 至 300 字的封禁原因'},{status:400});
        const until = banUntil ?? (Number.isInteger(days) && days > 0 ? Date.now() + days * 86400000 : null);
        if (!validManualBanUntil(until)) return Response.json({error:'请填写未来 365 天内的封禁解除时间'},{status:400});
        const applied=await setTimedBan(env,kind,id,banReason,until,account.role,isInitialSystem);
        if(!applied)return Response.json({error:'账户不存在或不可操作'},{status:404});
        return Response.json({message:'已封禁账户'});
      }
      const target=findAccount((await readAccounts(env,kind)).content,kind,id);
      if(!target||target.role==='system')return Response.json({error:'账户不存在或不可操作'},{status:404});
      // Revoke before lifting a ban so it cannot restore an old login.
      let unbanDenied = false;
      await changeSessions(env,rows=>{
        unbanDenied = operation==='unban' && !isInitialSystem && requiresInitialSystemToUnban(timedBan(rows,kind,id),target.banned);
        if (unbanDenied) return false;
        let changed=operation==='unban'&&clearTimedBan(rows,kind,id);
        for(const item of rows)if(item.kind===kind&&item.id===id&&!item.revoked){item.revoked=true;changed=true;}
        return changed;
      });
      if (unbanDenied) return Response.json({error:'当前账户无权解除此封禁'},{status:403});
      if(operation==='unban'&&target.banned&&!await setBan(env,kind,id,false))return Response.json({error:'账户不存在或不可操作'},{status:404});
      return Response.json({message:operation==='kick'?'已强制下线':operation==='ban'?'已封禁账户':'已解除封禁'});
    }
    return new Response(null,{status:405});
  }catch(error){
    if(error.code==='GITEE_WRITE_CONFLICT')return Response.json({error:'账户状态正在被更新，请刷新后重试'},{status:409});
    if(error.code==='GITEE_RATE_LIMIT')return Response.json({error:'数据服务请求过多，请稍后重试'},{status:503,headers:{'Retry-After':'2'}});
    console.error('[account-security]',request.method,error.name,error.code || '');
    return Response.json({error:'账户状态暂时无法更新，请刷新核对后重试'},{status:503});
  }
}
