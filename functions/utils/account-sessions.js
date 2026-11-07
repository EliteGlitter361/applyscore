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
export async function changeSessions(env,update){
  for(let attempt=0;attempt<4;attempt++){
    const file=await readSessions(env),rows=file.content||[];
    const changed=update(rows);
    if(!changed)return;
    try{await writeJsonToGitee(env,sessionsPath,rows,file.sha,'update account sessions');return;}
    catch(e){if(attempt===3||!/(409|422|sha|conflict|already exists)/i.test(e.message))throw e;}
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
const deviceWindow=24*60*60*1000;

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

export async function recordLoginFailure(env,kind,id){
  const now=Date.now();
  await changeSessions(env,rows=>{
    const record=ensureRiskRecord(rows,kind,id);
    const recent=record.failures.filter(time=>now-time<failureWindow);
    // Saturate once enough failures have been recorded to limit storage writes.
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
  else if(devices.some(item=>item.newDeviceAt&&now-item.newDeviceAt<3600000))add(1,'近1小时切换至近期未见的设备');
  if(onlineCount>=3)add(onlineCount>=5?2:1,'当前有 '+onlineCount+' 台设备在线');
  const observed=!!record||rows.some(row=>row.kind===kind&&row.id===id);
  const recentDevices=devices.map(item=>({
    name:item.name||deviceLabel(rows.find(row=>row.kind===kind&&row.id===id&&row.deviceId===item.id)?.device),
    seenAt:item.seenAt,
    isNew:!!item.newDeviceAt&&now-item.newDeviceAt<3600000
  })).sort((a,b)=>b.seenAt-a.seenAt);
  return {level:['low','medium','high'][severity],recentDevices,reasons:reasons.length?reasons:[observed?'当前记录未触发异常规则':'暂无登录记录，证据不足']};
}

export async function createSession(env,kind,id,request,isSystem=false){
  const token='session-'+crypto.randomUUID()+crypto.randomUUID();
  const now=Date.now();
  const rawId=request.headers.get('X-Credit-Device-Id')||'';
  const deviceId=/^[a-z0-9-]{20,80}$/i.test(rawId)?rawId:null;
  let model='';
  try{model=decodeURIComponent(request.headers.get('X-Credit-Device-Name')||'').trim().slice(0,120);}catch{}
  const device=model||deviceLabel(request.headers.get('User-Agent')||'');
  await changeSessions(env,rows=>{
    if(deviceId&&!isSystem){
      const record=ensureRiskRecord(rows,kind,id);
      const devices=record.devices.filter(item=>now-item.seenAt<deviceWindow);
      const existing=devices.find(item=>item.id===deviceId);
      const previousSession=rows.some(row=>row.kind===kind&&row.id===id&&row.deviceId&&row.deviceId!==deviceId&&now-row.loginAt<deviceWindow);
      const newDeviceAt=existing?.newDeviceAt||(!existing&&(devices.length||previousSession)?now:null);
      record.devices=[...devices.filter(item=>item.id!==deviceId),{id:deviceId,name:device,seenAt:now,newDeviceAt}].slice(-20);
    }
    const single=isSystem||loginPolicy(rows)[kind]==='single';
    for(let index=rows.length-1;index>=0;index--){
      const row=rows[index];
      if(row.kind!==kind||row.id!==id)continue;
      if(single||row.expiresAt<=now||(deviceId&&deviceId===row.deviceId))rows.splice(index,1);
    }
    rows.push({kind,id,token,loginAt:now,seenAt:now,device,deviceId,expiresAt:now+12*3600000});
    return true;
  });
  return token;
}
export async function resolveSession(env,token){
  if(!token?.startsWith('session-'))return {state:'revoked'};
  const records=(await readSessions(env)).content||[];
  const row=records.find(x=>x.token===token);
  if(!row)return {state:'revoked'};
  const accounts=(await readAccounts(env,row.kind)).content||[];
  const account=findAccount(accounts,row.kind,row.id);
  if(account?.banned)return {state:'banned',row};
  if(!account||row.revoked||row.expiresAt<=Date.now())return {state:'revoked',row};
  return {state:'online',row,account,records,accounts};
}
export async function setBan(env,kind,id,banned){
  const file=await readAccounts(env,kind),account=findAccount(file.content,kind,id);
  if(!account||account.role==='system')return false;
  account.banned=banned;
  const write=kind==='admin'?writeAccountJson:writeJsonToGitee;
  await write(env,accountPath(kind),file.content,file.sha,'update account ban');
  return true;
}
