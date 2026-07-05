import { getFileFromGitee, writeJsonToGitee } from '../utils/gitee';

export async function onRequest(context) {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token) {
    return new Response(JSON.stringify({ error: '未授权' }), { status: 401, headers });
  }

  if (request.method === 'GET') {
    try {
      const result = await getFileFromGitee(env, 'data/app.json');
      const apps = result.content || [];
      const pending = apps.filter(a => a.status === 'pending');
      return new Response(JSON.stringify(pending), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  if (request.method === 'PUT') {
    try {
      const body = await request.json();
      const { id, action, modifications } = body;  // 使用 id
      if (!id || !action) {
        return new Response(JSON.stringify({ error: '参数缺失' }), { status: 400, headers });
      }

      const result = await getFileFromGitee(env, 'data/app.json');
      const apps = result.content || [];
      const sha = result.sha;
      const index = apps.findIndex(a => a.id === id);
      if (index === -1) {
        return new Response(JSON.stringify({ error: '应用不存在' }), { status: 404, headers });
      }

      const app = apps[index];
      switch (action) {
        case 'approve': app.status = 'approved'; break;
        case 'reject': app.status = 'rejected'; break;
        case 'skip': break;
        case 'modify':
          if (modifications) {
            // 只允许修改部分字段
            if (modifications.name) app.name = modifications.name;
            if (modifications.versionName) app.versionName = modifications.versionName;
            if (modifications.publisher) app.publisher = modifications.publisher;
            if (modifications.participants !== undefined) app.participants = modifications.participants;
            if (modifications.packageName) app.packageName = modifications.packageName;
          }
          break;
        default: return new Response(JSON.stringify({ error: '无效操作' }), { status: 400, headers });
      }

      await writeJsonToGitee(env, 'data/app.json', apps, sha, `audit ${action} ${id}`);
      return new Response(JSON.stringify({ message: '操作成功' }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  return new Response('Method not allowed', { status: 405 });
}