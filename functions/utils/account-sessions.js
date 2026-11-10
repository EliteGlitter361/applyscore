import {getFileFromGitee,writeJsonToGitee} from './gitee.js';
import {getAccountJson,writeAccountJson} from './accounts.js';

const sessionsPath='data/account-sessions.json';
export const accountPath=kind=>kind==='admin'?'data/adminuser.json':'data/students.json';
export const accountId=(kind,row)=>String(kind==='admin'?row.username:row.studentId);
export function readAccounts(env,kind){
  return kind==='admin'?getAccountJson(env,accountPath(kind)):getFileFromGitee(env,accountPath(kind));
}
export function readSessions(env){return getFileFromGitee(env,sessionsPath);}
export function findAccount(rows,kind,id){return (rows||[]).find(row=>accountId(kind,row)===id);}
export async function changeSessions(env,update,{retryRateLimit=true}={}){
  for(let attempt=0;attempt<5;attempt++){
    const file=await readSessions(env),rows=file.content||[];
    const changed=update(rows);
    if(!changed)return;
    try{await writeJsonToGitee(env,sessionsPath,rows,file.sha,'update account sessions');return;}
    catch(error){
      const retryable = error.code==='GITEE_WRITE_CONFLICT' || (retryRateLimit && error.code==='GITEE_RATE_LIMIT');
      if(attempt===4 || !retryable)throw error;
      await new Promise(resolve=>setTimeout(resolve,80*(attempt+1)+Math.random()*120));
    }
  }
}
export function loginPolicy(rows){
  const modes=rows?.find(x=>x.kind==='policy')?.modes;
  return {student:modes?.student==='multiple'?'multiple':'single',admin:modes?.admin==='multiple'?'multiple':'single'};
}
export function deviceLabel(ua){
  if(!ua)return '未知设备';
  if(!ua.startsWith('Mozilla/'))return ua.slice(0,120);
  const android=ua.match(/Android[^;)]*;\s*(?:[a-z]{2}-[a-z]{2};\s*)?([^;)]+)(?:[;)])/i);
  if(android){
    const model=android[1].replace(/\s*Build\/.*$/i,'').trim();
    return /^(K|wv|Mobile)$/i.test(model)?'Android 设备':model;
  }
  if(/Android/i.test(ua))return 'Android 设备';
  if(/iPhone|iPad|iPod/i.test(ua))return ua.match(/iPhone|iPad|iPod/i)[0];
  if(/Windows/i.test(ua))return 'Windows 电脑';
  if(/Macintosh/i.test(ua))return 'Mac';
  if(/Linux/i.test(ua))return 'Linux 设备';
  return '未知设备';
}
const failureWindow=15*60*1000;
const hour=60*60*1000;
const deviceWindow=24*hour;
export const maxDeviceWindowHours=168;

function findRiskRecord(rows,kind,id){
  return rows.find(row=>row.kind==='risk'&&row.accountKind===kind&&row.id===id);
}

function ensureRiskRecord(rows,kind,id){
  let record=findRiskRecord(rows,kind,id);
  if(!record){
    record={kind:'risk',accountKind:kind,id,failures:[],devices:[]};
    rows.push(record);
  }
  return record;
}

function browserDeviceId(request){
  const id=request?.headers.get('X-Credit-Device-Id')||'';
  return /^[a-z0-9-]{20,80}$/i.test(id)?id:null;
}
export async function recordLoginFailure(env,kind,id,request){
  const deviceId=browserDeviceId(request);
  const now=Date.now();
  await changeSessions(env,rows=>{
    const record=ensureRiskRecord(rows,kind,id);
    const recent=record.failures.filter(time=>now-time<failureWindow);
    const rules=riskRules(rows);
    const rule=rules.loginFailures;
    const trackDevice=rule.enabled && deviceId && (kind==='student'||rules.includeAdmin);
    if(trackDevice){
      const failures=(record.browserFailures||[]).filter(item=>now-item.at<failureWindow);
      if(failures.filter(item=>item.id===deviceId).length<rule.limit){
        record.browserFailures=[...failures,{id:deviceId,at:now}].slice(-240);
        if(recent.length<8)record.failures=[...recent,now];
        return true;
      }
    }
    if(recent.length>=8)return false;
    record.failures=[...recent,now];
    return true;
  });
}

export function accountRisk(rows,kind,id,onlineCount,now){
  const record=findRiskRecord(rows,kind,id);
  const failures=record?.failures.filter(time=>now-time<failureWindow).length||0;
  const devices=record?.devices.filter(item=>now-item.seenAt<deviceWindow)||[];
  const reasons=[];
  let severity=0;
  function add(level,reason){severity=Math.max(severity,level);reasons.push(reason);}
  if(failures>=3)add(failures>=8?2:1,'近15分钟登录失败至少 '+failures+' 次');
  if(devices.length>=3)add(devices.length>=5?2:1,'近24小时使用 '+devices.length+' 个浏览器设备登录');
  if(onlineCount>=3)add(onlineCount>=5?2:1,'当前有 '+onlineCount+' 台设备在线');
  const observed=!!record||rows.some(row=>row.kind===kind&&row.id===id);
  const recentDevices=devices.map(item=>({
    name:item.name||deviceLabel(rows.find(row=>row.kind===kind&&row.id===id&&row.deviceId===item.id)?.device),
    seenAt:item.seenAt
  })).sort((a,b)=>b.seenAt-a.seenAt);
  return {level:['low','medium','high'][severity],recentDevices,reasons:reasons.length?reasons:[observed?'当前记录未触发异常规则':'暂无登录记录，证据不足']};
}

const defaultRiskRules={
  submission:{enabled:false,limit:5,days:1},
  loginFailures:{enabled:false,limit:5,days:1},
  loginFrequency:{enabled:false,limit:5,days:1},
  deviceCount:{enabled:false,limit:3,days:1,windowHours:24},
  applicationWithdrawals:{enabled:false,limit:5,days:1},
  applicationRevisions:{enabled:false,limit:5,days:1}
};
export function riskRules(rows){
  const stored=rows.find(row=>row.kind==='risk-policy')?.rules;
  return {
    includeAdmin:stored?.includeAdmin===true,
    submission:{...defaultRiskRules.submission,...stored?.submission},
    loginFailures:{...defaultRiskRules.loginFailures,...stored?.loginFailures},
    loginFrequency:{...defaultRiskRules.loginFrequency,...stored?.loginFrequency},
    deviceCount:{...defaultRiskRules.deviceCount,...stored?.deviceCount},
    applicationWithdrawals:{...defaultRiskRules.applicationWithdrawals,...stored?.applicationWithdrawals},
    applicationRevisions:{...defaultRiskRules.applicationRevisions,...stored?.applicationRevisions}
  };
}
export function timedBan(rows,kind,id,now=Date.now()){
  const ban=findRiskRecord(rows,kind,id)?.ban;
  return ban?.until>now ? ban : null;
}
function applyRiskBan(rows,record,reason,days,now){
  const ban = applyTimedBan(rows,record,reason,now+days*86400000);
  ban.source = 'risk';
  return ban;
}
function applyTimedBan(rows,record,reason,until){
  record.ban={reason,until};
  for(const row of rows){
    if(row.kind===record.accountKind&&row.id===record.id)row.revoked=true;
  }
  return record.ban;
}
export async function checkSubmissionRisk(env,session){
  const {row,records}=session;
  if(row.kind!=='student'||!riskRules(records).submission.enabled)return null;
  let ban;
  await changeSessions(env,rows=>{
    ban=timedBan(rows,row.kind,row.id);
    if(ban)return false;
    const rules=riskRules(rows);
    const rule=rules.submission;
    if(!rule.enabled)return false;
    const record=ensureRiskRecord(rows,row.kind,row.id);
    const now=Date.now();
    record.submissions=(record.submissions||[]).filter(time=>now-time<60000);
    if(record.submissions.length>=rule.limit){
      ban=applyRiskBan(rows,record,'一分钟内提交次数超限',rule.days,now);
    }else record.submissions.push(now);
    return true;
  },{retryRateLimit:false});
  return ban;
}
export async function checkApplicationActionRisk(env,session,action){
  if(session?.state!=='online'||session.row.kind!=='student'||!['applicationWithdrawals','applicationRevisions'].includes(action))return null;
  if(!riskRules(session.records||[])[action].enabled)return null;
  let ban;
  await changeSessions(env,rows=>{
    const {kind,id}=session.row;
    const now=Date.now();
    ban=timedBan(rows,kind,id,now);
    if(ban)return false;
    const rule=riskRules(rows)[action];
    if(!rule.enabled)return false;
    const record=ensureRiskRecord(rows,kind,id);
    const recent=(record[action]||[]).filter(at=>now-at<10*60000);
    if(recent.length>=rule.limit){
      const reason=action==='applicationWithdrawals'?'十分钟内撤回申请次数超限':'十分钟内修改并重新提交次数超限';
      ban=applyRiskBan(rows,record,reason,rule.days,now);
    }else record[action]=[...recent,now];
    return true;
  });
  return ban?Response.json({code:'ACCOUNT_BANNED',error:ban.reason,banReason:ban.reason,banUntil:ban.until},{status:403}):null;
}
export function clearTimedBan(rows,kind,id){
  const record=findRiskRecord(rows,kind,id);
  if(!record?.ban)return false;
  delete record.ban;
  delete record.approvedDevice;
  record.browserFailures=[];
  record.successfulLogins=[];
  record.devices=[];
  record.submissions=[];
  record.applicationWithdrawals=[];
  record.applicationRevisions=[];
  return true;
}

export async function createSession(env,kind,id,request,isSystem=false){
  const token='session-'+crypto.randomUUID()+crypto.randomUUID();
  const now=Date.now();
  const deviceId=browserDeviceId(request);
  let model='';
  try{model=decodeURIComponent(request.headers.get('X-Credit-Device-Name')||'').trim().slice(0,120);}catch{}
  const device=model||deviceLabel(request.headers.get('User-Agent')||'');
  let ban;
  await changeSessions(env,rows=>{
    ban=isSystem?null:timedBan(rows,kind,id,now);
    if(ban)return false;
    const previousRecord=findRiskRecord(rows,kind,id);
    let successfulLogins;
    if(!isSystem){
      const rules=riskRules(rows);
      const inScope=kind==='student'||rules.includeAdmin;
      const record=ensureRiskRecord(rows,kind,id);
      const attempts=(record.browserFailures||[]).filter(item=>now-item.at<failureWindow);
      const logins=(record.successfulLogins||[]).filter(time=>now-time<60000);
      const hits=[];
      if(inScope&&rules.loginFailures.enabled&&deviceId&&attempts.filter(item=>item.id===deviceId).length>=rules.loginFailures.limit){
        hits.push(['同一浏览器近期输错密码次数达到上限',rules.loginFailures.days]);
      }
      if(inScope&&rules.loginFrequency.enabled&&logins.length>=rules.loginFrequency.limit){
        hits.push(['一分钟内登录次数超限',rules.loginFrequency.days]);
      }
      if(hits.length){
        ban=applyRiskBan(rows,record,hits.map(hit=>hit[0]).join('；'),Math.max(...hits.map(hit=>hit[1])),now);
        return true;
      }
      if(inScope&&rules.loginFrequency.enabled)successfulLogins=[...logins,now];
      if(deviceId)record.browserFailures=attempts.filter(item=>item.id!==deviceId);
    }
    if(deviceId&&!isSystem){
      const record=ensureRiskRecord(rows,kind,id);
      const recent=new Map();
      // Older accounts may only have session history. Once a risk record exists,
      // use it exclusively so that an explicit reset does not restore old devices.
      if(!previousRecord){
        for(const row of rows){
          if(row.kind!==kind||row.id!==id||!row.deviceId||now-row.loginAt>=maxDeviceWindowHours*hour)continue;
          const known=recent.get(row.deviceId);
          if(!known||known.seenAt<row.loginAt)recent.set(row.deviceId,{id:row.deviceId,name:row.device,seenAt:row.loginAt});
        }
      }
      for(const item of record.devices){
        if(now-item.seenAt<maxDeviceWindowHours*hour)recent.set(item.id,item);
      }
      const devices=[...recent.values()];
      const nextDevices=[...devices.filter(item=>item.id!==deviceId),{id:deviceId,name:device,seenAt:now}]
        .sort((a,b)=>a.seenAt-b.seenAt).slice(-200);
      const rules=riskRules(rows);
      const count=rules.deviceCount;
      const inScope=kind==='student'||rules.includeAdmin;
      if(inScope&&count.enabled&&nextDevices.filter(item=>now-item.seenAt<count.windowHours*hour).length>=count.limit){
        ban=applyRiskBan(rows,record,'最近 '+count.windowHours+' 小时内登录设备达到上限',count.days,now);
        return true;
      }
      record.devices=nextDevices;
    }
    if(successfulLogins)ensureRiskRecord(rows,kind,id).successfulLogins=successfulLogins;
    const single=isSystem||loginPolicy(rows)[kind]==='single';
    for(let index=rows.length-1;index>=0;index--){
      const row=rows[index];
      if(row.kind!==kind||row.id!==id)continue;
      if(single||row.expiresAt<=now||(deviceId&&deviceId===row.deviceId))rows.splice(index,1);
    }
    rows.push({kind,id,token,loginAt:now,seenAt:now,device,deviceId,expiresAt:now+12*3600000});
    return true;
  });
  if(ban)throw Object.assign(new Error('账户已被封禁'),{code:'ACCOUNT_BANNED',banUntil:ban.until,banReason:ban.reason});
  return token;
}
export async function resolveSession(env,token){
  if(!token?.startsWith('session-'))return {state:'revoked'};
  const records=(await readSessions(env)).content||[];
  const row=records.find(x=>x.token===token);
  if(!row)return {state:'revoked'};
  const accounts=(await readAccounts(env,row.kind)).content||[];
  const account=findAccount(accounts,row.kind,row.id);
  const ban=timedBan(records,row.kind,row.id);
  if(account?.banned || ban)return {state:'banned',row,
    banReason:account?.banned?account.banReason:ban.reason,banUntil:account?.banned?null:ban.until};
  if(!account||row.revoked||row.expiresAt<=Date.now())return {state:'revoked',row};
  return {state:'online',row,account,records,accounts};
}
export function cleanBanReason(value){
  return typeof value==='string'&&value.trim().length<=300 ? value.trim() : '';
}
export function validManualBanUntil(until,now=Date.now()){
  return Number.isSafeInteger(until) && until>now && until<=now+365*86400000;
}
export function isRiskBan(ban) {
  return !!ban && !['admin','system','initial-system','delegated-system'].includes(ban.source);
}
export function requiresInitialSystemToUnban(ban, permanent = false) {
  return permanent || isRiskBan(ban) || ['system','initial-system'].includes(ban?.source);
}
export function studentBanStatus(student, records, actor, isInitialSystem = false) {
  const ban = timedBan(records, 'student', String(student.studentId));
  return {
    banned: !!student.banned || !!ban,
    banUntil: student.banned ? null : ban?.until ?? null,
    canUnban: requiresInitialSystemToUnban(ban, student.banned) ? isInitialSystem : actor.role === 'system' || (!student.banned && ban?.source === 'admin')
  };
}
export async function setTimedBan(env,kind,id,reason,until,source,isInitialSystem=false){
  const account=findAccount((await readAccounts(env,kind)).content,kind,id);
  if(!account||account.role==='system'||account.banned)return false;
  let applied = false;
  await changeSessions(env,rows=>{
    const existing = timedBan(rows,kind,id);
    applied = (!requiresInitialSystemToUnban(existing) || isInitialSystem) &&
      (source !== 'admin' || !existing || existing.source === 'admin');
    if (!applied) return false;
    applyTimedBan(rows,ensureRiskRecord(rows,kind,id),reason,until).source =
      source === 'system' ? (isInitialSystem ? 'initial-system' : 'delegated-system') : source;
    return true;
  });
  return applied;
}
export async function setBan(env,kind,id,banned,reason){
  const file=await readAccounts(env,kind),account=findAccount(file.content,kind,id);
  if(!account||account.role==='system')return false;
  account.banned=banned;
  if(banned)account.banReason=reason;else delete account.banReason;
  const write=kind==='admin'?writeAccountJson:writeJsonToGitee;
  await write(env,accountPath(kind),file.content,file.sha,'update account ban');
  return true;
}
