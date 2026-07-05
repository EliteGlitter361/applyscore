import { getJsonFromGithub, writeJsonToGithub } from '../../utils/github';

function simpleHash(str, salt = 'appstore') {
  let hash = 0;
  const full = salt + str;
  for (let i = 0; i < full.length; i++) {
    hash = ((hash << 5) - hash) + full.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

export async function onRequest(context) {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers });
  }

  try {
    const body = await request.json();
    const { username, password, confirmPassword } = body;

    if (!username || !password || !confirmPassword) {
      return new Response(JSON.stringify({ error: '请填写完整信息' }), { status: 400, headers });
    }
    if (password.length < 8) {
      return new Response(JSON.stringify({ error: '密码长度至少8位' }), { status: 400, headers });
    }
    if (password !== confirmPassword) {
      return new Response(JSON.stringify({ error: '两次密码不一致' }), { status: 400, headers });
    }

    const { content: admins } = await getJsonFromGithub(env, 'data/adminuser.json');
    if (admins && admins.some(u => u.role === 'system')) {
      return new Response(JSON.stringify({ error: '系统已存在 system 账户，无法重复创建' }), { status: 403, headers });
    }
    if (admins && admins.some(u => u.username === username)) {
      return new Response(JSON.stringify({ error: '用户名已存在' }), { status: 409, headers });
    }

    const newSystem = {
      id: (admins?.length || 0) + 1,
      username,
      password: simpleHash(password),
      role: 'system',
      auditPermission: 1,
    };

    const updatedAdmins = [...(admins || []), newSystem];
    const { sha } = (await getJsonFromGithub(env, 'data/adminuser.json')) || {};
    await writeJsonToGithub(env, 'data/adminuser.json', updatedAdmins, sha || null, 'init system admin');

    const { password: _, ...safeUser } = newSystem;
    return new Response(JSON.stringify({ message: 'system 账户创建成功', user: safeUser }), { status: 201, headers });
  } catch (e) {
    console.error('Init system error:', e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}