import { getFileFromGitee, writeJsonToGitee } from '../utils/gitee';
import { getJsonFromGithub } from '../utils/github';

async function getAdminInfo(env, token) {
  if (!token || !token.startsWith('fake-jwt-')) return null;
  const username = token.replace('fake-jwt-', '');
  try {
    const { content: admins } = await getJsonFromGithub(env, 'data/adminuser.json');
    return admins?.find(a => a.username === username) || null;
  } catch {
    return null;
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token) {
    return new Response(JSON.stringify({ error: '未授权' }), { status: 401, headers });
  }

  const admin = await getAdminInfo(env, token);
  if (!admin) {
    return new Response(JSON.stringify({ error: '管理员身份无效' }), { status: 403, headers });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  // GET：获取所有学生（补全 banned 默认值）
  if (request.method === 'GET' && path === '/api/students') {
    try {
      const result = await getFileFromGitee(env, 'data/students.json');
      const students = (result.content || []).map(s => ({
        ...s,
        banned: s.banned ?? false,
      }));
      return new Response(JSON.stringify(students), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // POST：添加学生
  if (request.method === 'POST' && path === '/api/students') {
    try {
      const { name, studentId } = await request.json();
      if (!name || !studentId) {
        return new Response(JSON.stringify({ error: '姓名和学号不能为空' }), { status: 400, headers });
      }
      const result = await getFileFromGitee(env, 'data/students.json');
      let students = result.content || [];
      const sha = result.sha;
      if (students.some(s => s.studentId === studentId)) {
        return new Response(JSON.stringify({ error: '该学号已存在' }), { status: 409, headers });
      }
      students.push({ name, studentId, banned: false });
      await writeJsonToGitee(env, 'data/students.json', students, sha, `add student ${studentId}`);
      return new Response(JSON.stringify({ message: '添加成功' }), { status: 201, headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // DELETE：删除学生
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

  // PUT：更新学生封禁状态
  if (request.method === 'PUT' && path === '/api/students') {
    if (!admin.canBan) {
      return new Response(JSON.stringify({ error: '您没有封禁学生的权限，请联系系统管理员授予。' }), { status: 403, headers });
    }
    try {
      const { studentId, banned } = await request.json();
      if (studentId === undefined || banned === undefined) {
        return new Response(JSON.stringify({ error: '缺少 studentId 或 banned 参数' }), { status: 400, headers });
      }
      const result = await getFileFromGitee(env, 'data/students.json');
      let students = result.content || [];
      const sha = result.sha;
      const student = students.find(s => s.studentId === studentId);
      if (!student) {
        return new Response(JSON.stringify({ error: '学号不存在' }), { status: 404, headers });
      }
      student.banned = !!banned;
      await writeJsonToGitee(env, 'data/students.json', students, sha, `update banned ${studentId} to ${banned}`);
      return new Response(JSON.stringify({ message: '更新成功' }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  return new Response('Method not allowed', { status: 405 });
}