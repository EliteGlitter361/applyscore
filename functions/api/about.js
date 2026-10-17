import { getFileFromGitee, writeJsonToGitee } from '../utils/gitee.js';
import { verifyAboutSession } from '../utils/about-session.js';
import { getJsonFromGithub } from '../utils/github.js';

const FILE = 'data/about.json';
const defaults = Object.freeze({
  title: '关于学分服务中心',
  subtitle: '让每一份成长都被看见',
  description: '学分服务中心提供活动学分申请、材料上传、进度查询和审核管理等服务。',
  organization: '',
  version: '1.7',
  contactEmail: '',
  website: ''
});
const limits = { title: 70, subtitle: 120, description: 3000, organization: 120, version: 40, contactEmail: 160, website: 350 };
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'GET') {
    try {
      const {content} = await getFileFromGitee(env, FILE);
      const data = content && typeof content === 'object' && !Array.isArray(content) ? content : {};
      const info = {...defaults};
      for (const field of Object.keys(limits)) if (typeof data[field] === 'string') info[field] = data[field];
      return reply({info, updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null});
    } catch (e) {
      console.error('[about read]', e);
      return reply({error:'暂时无法读取关于信息，请稍后重试'}, 503);
    }
  }
  if (request.method !== 'PUT') return reply({error:'Method not allowed'}, 405);
  const auth = request.headers.get('Authorization') || '';
  const token = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
  const session = await verifyAboutSession(env, token);
  if (!session) return reply({error:'请使用 system 账户重新登录后保存'}, 403);
  try {
    // Reconfirm current role: an old signed token cannot write after revocation.
    const users = (await getJsonFromGithub(env, 'data/adminuser.json')).content;
    if (!Array.isArray(users) || !users.some(user => user.username === session.username && user.role === 'system')) {
      return reply({error:'system 账户无效或权限已变更'}, 403);
    }
    const input = await request.json();
    if (!input || typeof input !== 'object' || Array.isArray(input)) return reply({error:'数据格式不正确'}, 400);
    const info = {};
    for (const [field, length] of Object.entries(limits)) {
      if (typeof input[field] !== 'string') return reply({error:`${field} 必须为文字`}, 400);
      const value = input[field].trim();
      if (value.length > length) return reply({error:`${field} 不能超过 ${length} 个字符`}, 400);
      info[field] = value;
    }
    if (!info.title) return reply({error:'请填写关于页面标题'}, 400);
    if (info.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.contactEmail)) return reply({error:'联系邮箱格式不正确'},400);
    if (info.website && !/^https?:\/\//i.test(info.website)) return reply({error:'网站链接须以 http:// 或 https:// 开头'},400);
    if (info.website) {
      try { const u = new URL(info.website); if (!['https:', 'http:'].includes(u.protocol)) throw Error(); }
      catch { return reply({error:'网站链接无效'},400); }
    }
    const current = await getFileFromGitee(env, FILE);
    const updatedAt = new Date().toISOString();
    await writeJsonToGitee(env, FILE, {...info, updatedAt}, current.sha, `update about information by ${session.username}`);
    return reply({info, updatedAt, message:'关于页面已保存到 Gitee'});
  } catch (e) {
    console.error('[about update]', e);
    return reply({error:'保存失败：' + (e?.message || '服务器错误')}, 502);
  }
}
