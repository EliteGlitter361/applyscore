import { getJsonFromGithub, writeJsonToGithub } from '../utils/github';
import { writeJsonToGitee } from '../utils/gitee';

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

  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token || !token.startsWith('fake-jwt-')) {
    return new Response(JSON.stringify({ error: '未授权' }), { status: 401, headers });
  }

  const url = new URL(request.url);
  const path = url.pathname;
  const action = url.searchParams.get('action');

  // ===== 允许任何已登录用户访问的接口 =====
  if (request.method === 'GET' && action === 'my-permissions') {
    const username = token.replace('fake-jwt-', '');
    try {
      const { content: admins } = await getJsonFromGithub(env, 'data/adminuser.json');
      const me = admins?.find(a => a.username === username);
      if (!me) {
        return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
      }
      // 严格转换为布尔值：0 -> false, 1 -> true, undefined -> 默认值
      const isSystem = me.role === 'system';
      const canBan = isSystem ? true : (me.canBan === true || me.canBan === 1);
      const auditPermission = isSystem ? true : (me.auditPermission === 1 || me.auditPermission === true);
      return new Response(JSON.stringify({
        username: me.username,
        role: me.role,
        canBan,
        auditPermission,
      }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // ===== 以下接口仅限 system =====
  if (token !== 'fake-jwt-system') {
    return new Response(JSON.stringify({ error: '需要 system 权限' }), { status: 403, headers });
  }

  // GET 管理员列表
  if (request.method === 'GET' && path === '/api/admin' && !action) {
    try {
      const { content } = await getJsonFromGithub(env, 'data/adminuser.json');
      const safeList = (content || []).map(({ password, ...rest }) => ({
        ...rest,
        canBan: rest.role === 'system' ? true : !!rest.canBan,
        auditPermission: rest.role === 'system' ? 1 : (rest.auditPermission ?? 0),
      }));
      return new Response(JSON.stringify(safeList), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // POST 创建管理员
  if (request.method === 'POST' && path === '/api/admin' && !action) {
    try {
      const { username, password, role, auditPermission } = await request.json();
      if (!username || !password) {
        return new Response(JSON.stringify({ error: '用户名密码必填' }), { status: 400, headers });
      }
      if (password.length < 8) {
        return new Response(JSON.stringify({ error: '密码长度至少8位' }), { status: 400, headers });
      }

      const { content: admins, sha } = await getJsonFromGithub(env, 'data/adminuser.json');
      if (admins?.some(a => a.username === username)) {
        return new Response(JSON.stringify({ error: '用户名已存在' }), { status: 409, headers });
      }

      const newAdmin = {
        id: (admins?.length || 0) + 1,
        username,
        password: simpleHash(password, 'appstore'),
        role: role || 'admin',
        auditPermission: role === 'system' ? 1 : (auditPermission ?? 0),
        canBan: role === 'system' ? true : false,
      };

      const updated = [...(admins || []), newAdmin];
      await writeJsonToGithub(env, 'data/adminuser.json', updated, sha, `create admin ${username}`);
      const { password: _, ...safe } = newAdmin;
      return new Response(JSON.stringify({ message: '创建成功', user: safe }), { status: 201, headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // PUT 更新权限
  if (request.method === 'PUT' && path === '/api/admin' && !action) {
    try {
      const { username, auditPermission, canBan } = await request.json();
      const { content: admins, sha } = await getJsonFromGithub(env, 'data/adminuser.json');
      const user = admins?.find(a => a.username === username);
      if (!user) {
        return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
      }

      if (auditPermission !== undefined) user.auditPermission = auditPermission ? 1 : 0;
      if (canBan !== undefined) user.canBan = !!canBan;
      await writeJsonToGithub(env, 'data/adminuser.json', admins, sha, `update admin ${username}`);
      return new Response(JSON.stringify({ message: '更新成功' }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // DELETE 删除管理员
  if (request.method === 'DELETE' && path === '/api/admin' && !action) {
    try {
      const { username } = await request.json();
      if (!username) {
        return new Response(JSON.stringify({ error: '缺少用户名' }), { status: 400, headers });
      }
      const { content: admins, sha } = await getJsonFromGithub(env, 'data/adminuser.json');
      const filtered = admins.filter(a => a.username !== username);
      if (filtered.length === admins.length) {
        return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
      }
      await writeJsonToGithub(env, 'data/adminuser.json', filtered, sha, `delete admin ${username}`);
      return new Response(JSON.stringify({ message: '删除成功' }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // 修改密码
  if (request.method === 'POST' && action === 'change-password') {
    try {
      const { username, newPassword } = await request.json();
      if (!username || !newPassword) {
        return new Response(JSON.stringify({ error: '用户名和新密码不能为空' }), { status: 400, headers });
      }
      if (newPassword.length < 8) {
        return new Response(JSON.stringify({ error: '新密码长度至少8位' }), { status: 400, headers });
      }
      const { content: admins, sha } = await getJsonFromGithub(env, 'data/adminuser.json');
      const user = admins?.find(a => a.username === username);
      if (!user) {
        return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
      }
      user.password = simpleHash(newPassword, 'appstore');
      await writeJsonToGithub(env, 'data/adminuser.json', admins, sha, `change password for ${username}`);
      return new Response(JSON.stringify({ message: '密码修改成功' }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // 清空系统数据
  if (request.method === 'POST' && action === 'clear-data') {
    try {
      const { confirm } = await request.json();
      if (confirm !== 'yes') {
        return new Response(JSON.stringify({ error: '未确认清空操作' }), { status: 400, headers });
      }
      await writeJsonToGitee(env, 'data/app.json', [], null, 'clear all apps');
      await writeJsonToGitee(env, 'data/students.json', [], null, 'clear all students');
      return new Response(JSON.stringify({ message: '系统数据已清空' }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // 获取登录日志
  if (request.method === 'GET' && action === 'login-logs') {
    try {
      const result = await getJsonFromGithub(env, 'data/loginlog.json');
      const logs = result.content || [];
      logs.sort((a, b) => new Date(b.time) - new Date(a.time));
      return new Response(JSON.stringify(logs), { headers });
    } catch (e) {
      if (e.message.includes('404') || e.message.includes('解析')) {
        return new Response(JSON.stringify([]), { headers });
      }
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
}