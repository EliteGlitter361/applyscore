import {recordLoginFailure,createSession,changeSessions} from '../utils/account-sessions.js';
import { getFileFromGitee, writeJsonToGitee } from '../utils/gitee';
import { getAccountJson } from '../utils/accounts.js';

async function getAdminInfo(env, token) {
  if (!token || !token.startsWith('fake-jwt-')) return null;
  const username = token.replace('fake-jwt-', '');
  try {
    const { content: admins } = await getAccountJson(env, 'data/adminuser.json');
    return admins?.find(a => a.username === username) || null;
  } catch {
    return null;
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  const url = new URL(request.url);
  const path = url.pathname;
  const action = url.searchParams.get('action');
  if (request.method === 'GET' && action === 'roster') {
    const session = context.data?.accountSession;
    if (session?.state !== 'online' || session.row.kind !== 'student') {
      return Response.json({error:'请先登录学生账号'},{status:401});
    }
    try {
      const {content} = await getFileFromGitee(env, 'data/students.json');
      return Response.json((content || []).map(({studentId,name}) => ({studentId:String(studentId),name})),
        {headers:{'Cache-Control':'no-store'}});
    } catch {
      return Response.json({error:'学生名单加载失败'},{status:503});
    }
  }

  // ============================================================
  // ===== 无需管理员权限的接口（学生自助） =====
  // ============================================================

  // 学生登录验证 (POST /api/students?action=verify)
  if (request.method === 'POST' && action === 'verify') {
    try {
      const { studentId, password } = await request.json();
      if (!studentId || !password) {
        return new Response(JSON.stringify({ error: '学号和密码不能为空' }), { status: 400, headers });
      }
      const result = await getFileFromGitee(env, 'data/students.json');
      const students = result.content || [];
      const student = students.find(s => s.studentId === studentId);
      if (!student) {
        return new Response(JSON.stringify({ error: '学号不存在' }), { status: 403, headers });
      }
      if (!student.password) {
        return new Response(JSON.stringify({ error: '该学号未设置密码，请联系管理员' }), { status: 403, headers });
      }
      if (student.password !== password) {
      await recordLoginFailure(env,'student',String(studentId)).catch(()=>{});
        return new Response(JSON.stringify({ error: '密码错误' }), { status: 403, headers });
      }
      if (student.banned) {
        return new Response(JSON.stringify({ code:'ACCOUNT_BANNED', error:'账户已被封禁' }), { status: 403, headers });
      }
      return new Response(JSON.stringify({
        user: { name: student.name, studentId: student.studentId },
        token: await createSession(env,'student',String(studentId),request),
      }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // 学生自助修改密码 (POST /api/students?action=change-password)
  if (request.method === 'POST' && action === 'change-password') {
    try {
      const { studentId, oldPassword, newPassword } = await request.json();
      if (!studentId || !oldPassword || !newPassword) {
        return new Response(JSON.stringify({ error: '缺少参数' }), { status: 400, headers });
      }
      if (newPassword.length < 6) {
        return new Response(JSON.stringify({ error: '新密码至少6位' }), { status: 400, headers });
      }
      const result = await getFileFromGitee(env, 'data/students.json');
      let students = result.content || [];
      const sha = result.sha;
      const student = students.find(s => s.studentId === studentId);
      if (!student) {
        return new Response(JSON.stringify({ error: '学号不存在' }), { status: 404, headers });
      }
      if (student.password !== oldPassword) {
        return new Response(JSON.stringify({ error: '当前密码错误' }), { status: 403, headers });
      }
      student.password = newPassword;
      await writeJsonToGitee(env, 'data/students.json', students, sha, `student change password ${studentId}`);
      return new Response(JSON.stringify({ message: '密码修改成功' }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // ============================================================
  // ===== 以下接口需要管理员权限 =====
  // ============================================================

  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token) {
    return new Response(JSON.stringify({ error: '未授权' }), { status: 401, headers });
  }

  const session=context.data?.accountSession;
  const admin=session?.state==='online'&&session.row.kind==='admin'&&token==='fake-jwt-'+session.row.id
    ?session.account:await getAdminInfo(env, token);
  if (!admin) {
    return new Response(JSON.stringify({ error: '管理员身份无效' }), { status: 403, headers });
  }

  // GET 获取所有学生
  if (request.method === 'GET' && path === '/api/students') {
    try {
      const result = await getFileFromGitee(env, 'data/students.json');
      const students = (result.content || []).map(s => ({
        ...s,
        banned: s.banned ?? false,
        password: s.password || '',
      }));
      return new Response(JSON.stringify(students), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // POST 添加学生
  if (request.method === 'POST' && path === '/api/students') {
    try {
      const { name, studentId, password } = await request.json();
      if (!name || !studentId) {
        return new Response(JSON.stringify({ error: '姓名和学号不能为空' }), { status: 400, headers });
      }
      const result = await getFileFromGitee(env, 'data/students.json');
      let students = result.content || [];
      const sha = result.sha;
      if (students.some(s => s.studentId === studentId)) {
        return new Response(JSON.stringify({ error: '该学号已存在' }), { status: 409, headers });
      }
      students.push({
        name,
        studentId,
        password: password || '',  // 密码可选，默认为空
        banned: false,
      });
      await writeJsonToGitee(env, 'data/students.json', students, sha, `add student ${studentId}`);
      return new Response(JSON.stringify({ message: '添加成功' }), { status: 201, headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // DELETE 删除学生
  if (request.method === 'DELETE' && path === '/api/students') {
    try {
      const { studentId } = await request.json();
      if (!studentId) {
        return new Response(JSON.stringify({ error: '学号不能为空' }), { status: 400, headers });
      }
      const result = await getFileFromGitee(env, 'data/students.json');
      let students = result.content || [];
      const sha = result.sha;
      const filtered = students.filter(s => s.studentId !== studentId);
      if (filtered.length === students.length) {
        return new Response(JSON.stringify({ error: '学号不存在' }), { status: 404, headers });
      }
      await writeJsonToGitee(env, 'data/students.json', filtered, sha, `delete student ${studentId}`);
      return new Response(JSON.stringify({ message: '删除成功' }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // PUT 更新学生（封禁 或 修改密码）
  if (request.method === 'PUT' && path === '/api/students') {
    try {
      const body = await request.json();
      const { studentId, banned, password } = body;

      // 权限检查：只有 canBan 为 true 或 system 才能封禁/解封
      if (banned !== undefined && ![true,1,'1','true'].includes(admin.canBan) && admin.role !== 'system') {
        return new Response(JSON.stringify({ error: '您没有封禁学生的权限' }), { status: 403, headers });
      }

      if (!studentId) {
        return new Response(JSON.stringify({ error: '缺少 studentId' }), { status: 400, headers });
      }
      const result = await getFileFromGitee(env, 'data/students.json');
      let students = result.content || [];
      const sha = result.sha;
      const student = students.find(s => s.studentId === studentId);
      if (!student) {
        return new Response(JSON.stringify({ error: '学号不存在' }), { status: 404, headers });
      }

      if(banned===false&&student.banned){
        await changeSessions(env,rows=>{
          let changed=false;
          for(const session of rows)if(session.kind==='student'&&session.id===String(studentId)&&!session.revoked){session.revoked=true;changed=true;}
          return changed;
        });
      }
      if (banned !== undefined) student.banned = !!banned;
      if (password !== undefined) student.password = password;

      await writeJsonToGitee(env, 'data/students.json', students, sha, `update student ${studentId}`);
      return new Response(JSON.stringify({ message: '更新成功' }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  return new Response('Method not allowed', { status: 405 });
}