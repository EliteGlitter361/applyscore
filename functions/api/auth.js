import { getJsonFromGithub } from '../utils/github';
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

    const { content: admins } = await getJsonFromGithub(env, 'data/adminuser.json');
    if (!admins) {
      return new Response(JSON.stringify({ error: '无管理员账户，请先创建 system 账户' }), { status: 403, headers });
    }

    const user = admins.find(a => a.username === username);
    if (!user) {
      return new Response(JSON.stringify({ error: '用户不存在' }), { status: 403, headers });
    }

    const hashedInput = simpleHash(password, 'appstore');
    if (user.password !== hashedInput) {
      return new Response(JSON.stringify({ error: '密码错误' }), { status: 403, headers });
    }

    // 记录登录日志
    try {
      const ip = request.headers.get('cf-connecting-ip') || 
                 request.headers.get('x-forwarded-for')?.split(',')[0] || 
                 'unknown';
      const userAgent = request.headers.get('user-agent') || 'unknown';
      const logEntry = { username, time: new Date().toISOString(), ip, userAgent };

      const logResult = await getJsonFromGithub(env, 'data/loginlog.json');
      let logs = logResult.content || [];
      const sha = logResult.sha;
      logs.push(logEntry);
      if (logs.length > 1000) logs = logs.slice(-1000);
      await (await import('../utils/github')).writeJsonToGithub(env, 'data/loginlog.json', logs, sha, 'add login log');
    } catch (e) {
      console.error('Failed to write login log:', e);
    }

    const { password: _, ...safeUser } = user;
    // 严格转换为布尔值
    const isSystem = safeUser.role === 'system';
    const responseUser = {
      ...safeUser,
      canBan: isSystem ? true : (safeUser.canBan === true || safeUser.canBan === 1),
      auditPermission: isSystem ? 1 : (safeUser.auditPermission === 1 || safeUser.auditPermission === true ? 1 : 0),
    };

    // Dedicated signed credential for About-page edits. Legacy tokens remain
    // compatible with existing routes, but are NOT accepted by /api/about PUT.
    let aboutToken = null;
    if (isSystem) {
      try { aboutToken = await makeAboutSession(env, responseUser); }
      catch (error) { console.error('[about session]', error); }
    }
    return new Response(JSON.stringify({ user: responseUser, token: 'fake-jwt-' + username, aboutToken }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}