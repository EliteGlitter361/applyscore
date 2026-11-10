import { effectiveAdminPermissions, writeAccountJson } from '../utils/accounts.js';
import { accountPath, findAccount, readAccounts } from '../utils/account-sessions.js';
import { writeJsonToGitee } from '../utils/gitee.js';

const json = (data, status = 200) => Response.json(data, {status, headers:{'Cache-Control':'no-store'}});

export async function onRequest({request, env, data}) {
  const session = data?.accountSession;
  if (session?.state !== 'online') return json({error:'请先登录'}, 401);
  if (request.method === 'GET') return json({name:session.account.welcomeName || ''});
  if (request.method !== 'PUT') return json({error:'不支持的操作'}, 405);
  if (session.row.kind !== 'admin' || !effectiveAdminPermissions(session.account, session.accounts).isInitialSystem) {
    return json({error:'当前账户无权设置欢迎称呼'}, 403);
  }
  const body = await request.json().catch(() => null);
  if (!['student','admin'].includes(body?.kind) || typeof body.id !== 'string' ||
      typeof body.name !== 'string' || body.name.trim().length > 40 || /[\x00-\x1f\x7f]/.test(body.name)) {
    return json({error:'请输入 40 字以内的欢迎称呼'}, 400);
  }
  const {kind, id} = body;
  const name = body.name.trim();
  try {
    const {content, sha} = await readAccounts(env, kind);
    const account = findAccount(content, kind, id);
    if (!account) return json({error:'账户不存在'}, 404);
    if ((account.welcomeName || '') !== name) {
      if (name) account.welcomeName = name;
      else delete account.welcomeName;
      const write = kind === 'admin' ? writeAccountJson : writeJsonToGitee;
      await write(env, accountPath(kind), content, sha, '更新主页欢迎称呼');
    }
    return json({name, message:'欢迎称呼已保存'});
  } catch (error) {
    if (error.code === 'GITEE_WRITE_CONFLICT') return json({error:'账户资料已变更，请刷新后重试'}, 409);
    return json({error:'欢迎称呼保存失败，请重试'}, 503);
  }
}
