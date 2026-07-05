import { getFileFromGitee } from '../../utils/gitee';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(s => s);
  const id = segments[2];  // 直接取ID
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const result = await getFileFromGitee(env, 'data/app.json');
    const apps = result.content || [];
    const app = apps.find(a => a.id === id);
    if (!app) {
      return new Response(JSON.stringify({ error: '应用不存在' }), { status: 404, headers });
    }
    return new Response(JSON.stringify(app), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}