import { getJsonFromGithub } from '../../utils/github';

export async function onRequest(context) {
  const { env } = context;
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (context.request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers });
  }

  try {
    const { content } = await getJsonFromGithub(env, 'data/adminuser.json');
    const admins = content || [];
    const hasSystem = admins.some(u => u.role === 'system');
    return new Response(JSON.stringify({ exists: hasSystem }), { headers });
  } catch (e) {
    if (e.message.includes('404')) {
      return new Response(JSON.stringify({ exists: false }), { headers });
    }
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}