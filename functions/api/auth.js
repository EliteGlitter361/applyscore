import { getJsonFromGithub, writeJsonToGithub } from '../utils/github';

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

    // ===== 记录登录日志 =====
    try {
      // 获取客户端 IP
      const ip = request.headers.get('cf-connecting-ip') || 
                 request.headers.get('x-forwarded-for')?.split(',')[0] || 
                 'unknown';
      // 获取用户代理（可选）
      const userAgent = request.headers.get('user-agent') || 'unknown';
      
      const logEntry = {
        username,
        time: new Date().toISOString(),
        ip,
        userAgent,
      };

      // 读取现有日志（使用 GitHub 存储）
      const logResult = await getJsonFromGithub(env, 'data/loginlog.json');
      let logs = logResult.content || [];
      const sha = logResult.sha;
      logs.push(logEntry);
      // 只保留最近1000条，避免文件过大
      if (logs.length > 1000) logs = logs.slice(-1000);
      await writeJsonToGithub(env, 'data/loginlog.json', logs, sha, 'add login log');
    } catch (e) {
      console.error('Failed to write login log:', e);
      // 不影响登录本身
    }

    const { password: _, ...safeUser } = user;
    return new Response(JSON.stringify({ user: safeUser, token: 'fake-jwt-' + username }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}