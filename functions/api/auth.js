import {effectiveAdminPermissions} from '../utils/accounts.js';
import {recordLoginFailure,createSession} from '../utils/account-sessions.js';
import { getAccountJson, writeAccountJson } from '../utils/accounts.js';
import { makeAboutSession } from '../utils/about-session.js';

function simpleHash(str, salt = 'appstore') {
  let hash = 0;
  const full = salt + str;
  for (let i = 0; i < full.length; i++) {
    const char = full.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

export async function onRequest(context) {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const { username, password } = await request.json();
    if (!username || !password) {
      return new Response(JSON.stringify({ error: '用户名和密码不能为空' }), { status: 400, headers });
    }

    const { content: admins } = await getAccountJson(env, 'data/adminuser.json');
    if (!admins) {
      return new Response(JSON.stringify({ error: '无管理员账户，请先创建 system 账户' }), { status: 403, headers });
    }

    const user = admins.find(a => a.username === username);
    if (!user) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 403, headers });
    }

    const hashedInput = simpleHash(password, 'appstore');
    if (user.password !== hashedInput) {
      if(user.role!=='system')await recordLoginFailure(env,'admin',username,request).catch(()=>{});
      return new Response(JSON.stringify({ error: '密码错误' }), { status: 403, headers });
    }

    if(user.banned)return Response.json({code:'ACCOUNT_BANNED',error:'账户已被封禁',banReason:user.banReason},{status:403});
    const token=await createSession(env,'admin',username,request,user.role==='system');
    // 记录登录日志
    try {
      const ip = request.headers.get('cf-connecting-ip') || 
                 request.headers.get('x-forwarded-for')?.split(',')[0] || 
                 'unknown';
      const userAgent = request.headers.get('user-agent') || 'unknown';
      const logEntry = { username, time: new Date().toISOString(), ip, userAgent };

      const logResult = await getAccountJson(env, 'data/loginlog.json');
      let logs = logResult.content || [];
      const sha = logResult.sha;
      logs.push(logEntry);
      if (logs.length > 1000) logs = logs.slice(-1000);
      await writeAccountJson(env, 'data/loginlog.json', logs, sha, 'add login log');
    } catch (e) {
      console.error('Failed to write login log:', e);
    }

    const { password: _, ...safeUser } = user;
    // 严格转换为布尔值
    const isSystem = safeUser.role === 'system';
    const responseUser = {
      ...safeUser,
      welcomeName: safeUser.welcomeName || '',
      ...effectiveAdminPermissions(safeUser,admins),
    };

    // Dedicated signed credential for About-page edits. Legacy tokens remain
    // compatible with existing routes, but are NOT accepted by /api/about PUT.
    let aboutToken = null;
    if (isSystem) {
      try { aboutToken = await makeAboutSession(env, responseUser); }
      catch (error) { console.error('[about session]', error); }
    }
    return new Response(JSON.stringify({ user: responseUser, token, aboutToken }), { headers });
  } catch (e) {
    if(e.code==='ACCOUNT_BANNED')return Response.json({code:e.code,error:e.message,banUntil:e.banUntil,banReason:e.banReason},{status:403,headers});
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}