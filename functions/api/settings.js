import { getFileFromGitee, writeJsonToGitee } from '../utils/gitee';

export async function onRequest(context) {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  // GET 获取设置
  if (request.method === 'GET') {
    try {
      const result = await getFileFromGitee(env, 'data/settings.json');
      const settings = result.content || { enabled: true, message: '系统维护中，请稍后再试。' };
      return new Response(JSON.stringify(settings), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ enabled: true, message: '系统维护中，请稍后再试。' }), { headers });
    }
  }

  // POST 更新设置（仅 system 可操作）
  if (request.method === 'POST') {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.replace('Bearer ', '');
    if (!token || token !== 'fake-jwt-system') {
      return new Response(JSON.stringify({ error: '需要 system 权限' }), { status: 403, headers });
    }

    try {
      const { enabled, message } = await request.json();
      if (typeof enabled !== 'boolean') {
        return new Response(JSON.stringify({ error: 'enabled 必须为布尔值' }), { status: 400, headers });
      }
      const newSettings = { enabled, message: message || '' };
      let sha = null;
      try {
        const result = await getFileFromGitee(env, 'data/settings.json');
        sha = result.sha;
      } catch (e) {}
      await writeJsonToGitee(env, 'data/settings.json', newSettings, sha, 'update settings');
      return new Response(JSON.stringify({ message: '设置已更新' }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  return new Response('Method not allowed', { status: 405 });
}