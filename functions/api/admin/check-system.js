import { getJsonFromGithub } from '../../utils/github';

export async function onRequest(context) {
  const { env } = context;
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store, max-age=0' };

  // These bindings belong to the Cloudflare Pages deployment, not the ZIP.
  // Never interpret an absent credential as an uninitialized account database.
  const required = ['GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO'];
  const missing = required.filter(key => typeof env?.[key] !== 'string' || !env[key].trim());

  if (context.request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers });
  }

  if (missing.length) {
    return new Response(JSON.stringify({
      error: 'Cloudflare Pages 未配置 GitHub 环境变量：' + missing.join('、'),
      code: 'GITHUB_CONFIG_MISSING',
      missing,
    }), { status: 503, headers });
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