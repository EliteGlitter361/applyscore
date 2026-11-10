import { getAccountJson, writeAccountJson, initialSystemAccount, effectiveAdminPermissions, adminFeatureKeys, adminDelegationKeys, permissionEnabled } from '../utils/accounts.js';
import { writeJsonToGitee } from '../utils/gitee';
import { changeSessions } from '../utils/account-sessions.js';

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
  const session = context.data?.accountSession;
  const verified = session?.state === 'online'
    && session.row.kind === 'admin'
    && session.row.id === token.slice(9) ? session : null;

  // ===== 允许任何已登录用户访问的接口 =====
  if (request.method === 'GET' && action === 'my-permissions') {
    try {
      if(!verified)return Response.json({error:'请先登录'},{status:401,headers});
      const me=verified.account;
      return Response.json({username:me.username,role:me.role,...effectiveAdminPermissions(me,verified.accounts)},{headers});
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // ===== 以下接口仅限 system =====
  const accountManagement=path==='/api/admin' && !action && ['GET','POST','PUT','DELETE'].includes(request.method);
  if (accountManagement ? verified?.account.role!=='system' : !effectiveAdminPermissions(verified?.account,verified?.accounts).isInitialSystem) {
    return new Response(JSON.stringify({ error: '需要 system 权限' }), { status: 403, headers });
  }

  // GET 管理员列表
  if (request.method === 'GET' && path === '/api/admin' && !action) {
    try {
      const content = verified?.accounts ?? (await getAccountJson(env, 'data/adminuser.json')).content;
      const access=effectiveAdminPermissions(verified.account,content);
      const safeList = (content || []).map(({password,...rest})=>{
        const target=effectiveAdminPermissions(rest,content);
        if (!access.canManagePermissions && rest.username !== verified.row.id) {
          return {id:rest.id, username:rest.username, role:rest.role, isInitialSystem:target.isInitialSystem};
        }
        return {...rest,...target,
          isCurrent:rest.username===verified.row.id,
          canDelete:access.isInitialSystem&&!target.isInitialSystem,
          canEditPermissions:access.canManagePermissions&&!target.isInitialSystem&&rest.username!==verified.row.id,
          canDelegate:access.isInitialSystem&&rest.role==='system'&&!target.isInitialSystem
        };
      });
      return new Response(JSON.stringify(safeList), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // POST 创建管理员
  if (request.method === 'POST' && path === '/api/admin' && !action) {
    try {
      const { username, password, role } = await request.json();
      if (!username || !password) {
        return new Response(JSON.stringify({ error: '用户名密码必填' }), { status: 400, headers });
      }
      if (password.length < 8) {
        return new Response(JSON.stringify({ error: '密码长度至少8位' }), { status: 400, headers });
      }

      const { content: admins, sha } = await getAccountJson(env, 'data/adminuser.json');
      const actor=admins?.find(account=>account.username===verified.row.id);
      if(!effectiveAdminPermissions(actor,admins).canCreateAccounts)return Response.json({error:'需要初始化 system 授予创建账户权限'},{status:403,headers});
      if(role!==undefined&&!['system','admin'].includes(role))return Response.json({error:'账户角色无效'},{status:400,headers});
      if (admins?.some(a => a.username === username)) {
        return new Response(JSON.stringify({ error: '用户名已存在' }), { status: 409, headers });
      }

      const newAdmin = {
        id: Math.max(0,...(admins||[]).map(account=>Number(account.id)||0)) + 1,
        username,
        password: simpleHash(password, 'appstore'),
        role: role || 'admin',
        ...Object.fromEntries([...adminFeatureKeys,...adminDelegationKeys].map(key=>[key,false])),
      };

      const updated = [...(admins || []), newAdmin];
      await writeAccountJson(env, 'data/adminuser.json', updated, sha, `create admin ${username}`);
      const { password: _, ...safe } = newAdmin;
      return new Response(JSON.stringify({ message: '创建成功', user: safe }), { status: 201, headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // PUT 更新权限
  if (request.method === 'PUT' && path === '/api/admin' && !action) {
    try {
      const payload=await request.json();
      const {username}=payload;
      const { content: admins, sha } = await getAccountJson(env, 'data/adminuser.json');
      const user = admins?.find(a => a.username === username);
      if (!user) {
        return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
      }

      const actor=admins.find(account=>account.username===verified.row.id);
      const access=effectiveAdminPermissions(actor,admins);
      if(!access.canManagePermissions||effectiveAdminPermissions(user,admins).isInitialSystem||user.username===verified.row.id){
        return Response.json({error:'无权修改此账户权限'},{status:403,headers});
      }
      const grants=adminDelegationKeys.filter(key=>Object.hasOwn(payload,key));
      if(grants.length&&(!access.isInitialSystem||user.role!=='system')){
        return Response.json({error:'只有初始化 system 可以授予管理权限'},{status:403,headers});
      }
      for(const key of [...adminFeatureKeys,...grants]){
        if(Object.hasOwn(payload,key))user[key]=permissionEnabled(payload[key]);
      }
      await writeAccountJson(env, 'data/adminuser.json', admins, sha, `update admin ${username}`);
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
      const { content: admins, sha } = await getAccountJson(env, 'data/adminuser.json');
      const initial=initialSystemAccount(admins);
      if(verified.row.id!==initial?.username || username===initial.username){
        return Response.json({error:username===initial?.username?'初始化 system 账户不能删除':'只有初始化 system 账户可以删除管理员'},{status:403,headers});
      }
      const filtered = (admins||[]).filter(a => a.username !== username);
      if (filtered.length === (admins||[]).length) {
        return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
      }
      await changeSessions(env,rows=>{
        const sessions=rows.filter(row=>row.kind==='admin'&&row.id===username&&!row.revoked);
        for(const session of sessions)session.revoked=true;
        return sessions.length>0;
      });
      await writeAccountJson(env, 'data/adminuser.json', filtered, sha, `delete admin ${username}`);
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
      const { content: admins, sha } = await getAccountJson(env, 'data/adminuser.json');
      const user = admins?.find(a => a.username === username);
      if (!user) {
        return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
      }
      user.password = simpleHash(newPassword, 'appstore');
      await writeAccountJson(env, 'data/adminuser.json', admins, sha, `change password for ${username}`);
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
      const result = await getAccountJson(env, 'data/loginlog.json');
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