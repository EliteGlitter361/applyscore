import { getAccountJson } from '../../utils/accounts.js';

export async function onRequest(context) {
  const { env } = context;
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store, max-age=0' };

  // 管理员账户现以 Gitee 为唯一数据源；缺少凭证不能被误判为未初始化。
  const required = ['GITEE_TOKEN', 'GITEE_OWNER', 'GITEE_REPO'];
  const missing = required.filter(key => typeof env?.[key] !== 'string' || !env[key].trim());

  if (context.request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers });
  }

  if (missing.length) {
    return new Response(JSON.stringify({
      error: 'Cloudflare Pages 未配置 Gitee 环境变量：' + missing.join('、'),
      code: 'GITEE_CONFIG_MISSING',
      missing,
    }), { status: 503, headers });
  }

  try {
    const { content } = await getAccountJson(env, 'data/adminuser.json');
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