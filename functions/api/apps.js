import { getFileFromGitee, writeJsonToGitee, writeFileToGitee } from '../utils/gitee';

export async function onRequest(context) {
  const { request, env } = context;
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers });

  // GET：获取所有应用（包括 pending, approved）
  if (request.method === 'GET') {
    try {
      const result = await getFileFromGitee(env, 'data/app.json');
      return new Response(JSON.stringify(result.content || []), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // POST：提交新申请（不再限制学号重复，生成唯一ID）
  if (request.method === 'POST') {
    try {
      const formData = await request.formData();
      const name = formData.get('name')?.trim();
      const packageName = formData.get('packageName')?.trim(); // 学号
      const versionName = formData.get('versionName')?.trim();
      const publisher = formData.get('publisher')?.trim();
      const participants = formData.get('participants')?.trim() || '';
      const screenshotFiles = formData.getAll('screenshots') || [];

      if (!name || !packageName || !versionName || !publisher) {
        return new Response(JSON.stringify({ error: '缺少必填字段' }), { status: 400, headers });
      }

      // 校验学生身份（仍然需要学生存在且未被封禁）
      let students = [];
      try {
        const studentResult = await getFileFromGitee(env, 'data/students.json');
        students = studentResult.content || [];
      } catch (e) {
        if (!e.message.includes('404')) throw e;
      }
      const validStudent = students.find(s => s.name === name && s.studentId === packageName);
      if (!validStudent) {
        return new Response(JSON.stringify({ 
          error: '姓名与学号不匹配，或您不在学生名单中，请联系管理员添加。' 
        }), { status: 403, headers });
      }
      if (validStudent.banned) {
        return new Response(JSON.stringify({ 
          error: '您的账号已被封禁，无法提交申请。如有疑问请联系管理员。' 
        }), { status: 403, headers });
      }

      // 生成唯一ID：时间戳 + 随机数
      const id = Date.now() + '_' + Math.random().toString(36).substr(2, 6) + '_' + packageName;

      // 上传截图（存储路径使用ID）
      const screenshotNames = [];
      for (const file of screenshotFiles) {
        if (!file || !file.name) continue;
        const arrayBuffer = await file.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
        const base64 = btoa(binary);
        const safeName = encodeURIComponent(file.name);
        const filePath = `data/appdata/${id}/${safeName}`;
        await writeFileToGitee(env, filePath, base64, null, `upload ${safeName}`);
        screenshotNames.push(safeName);
      }

      const newApp = {
        id,
        name,
        packageName,         // 学号（用于显示）
        versionName,
        publisher,
        participants,
        screenshots: screenshotNames,
        status: 'pending',
        createdAt: Date.now(),
      };

      // 写入数据
      let apps = [], sha = null;
      try {
        const result = await getFileFromGitee(env, 'data/app.json');
        apps = result.content || [];
        sha = result.sha;
      } catch (e) {
        if (!e.message.includes('404')) throw e;
      }
      apps.push(newApp);
      await writeJsonToGitee(env, 'data/app.json', apps, sha, `add app ${id}`);
      return new Response(JSON.stringify({ message: '提交成功，等待审核', app: newApp }), { status: 201, headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // DELETE：永久删除（批量），使用ID数组
  if (request.method === 'DELETE') {
    try {
      const { ids } = await request.json();
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return new Response(JSON.stringify({ error: '请提供要删除的 IDs 数组' }), { status: 400, headers });
      }
      const result = await getFileFromGitee(env, 'data/app.json');
      let apps = result.content || [];
      const sha = result.sha;
      const filtered = apps.filter(a => !ids.includes(a.id));
      if (filtered.length === apps.length) {
        return new Response(JSON.stringify({ error: '没有找到可删除的申请' }), { status: 404, headers });
      }
      await writeJsonToGitee(env, 'data/app.json', filtered, sha, `permanently delete ${ids.join(',')}`);
      return new Response(JSON.stringify({ message: '永久删除成功' }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  return new Response('Method not allowed', { status: 405, headers });
}