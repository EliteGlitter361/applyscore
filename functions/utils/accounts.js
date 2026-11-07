// 管理员账户与登录日志统一存储在 Gitee；仅在 Gitee 文件尚不存在时，
// 从旧 GitHub 文件执行一次性服务端迁移。Token 仅存在于 Pages Functions 环境。
import { getFileFromGitee, writeJsonToGitee, requireGiteeConfig } from './gitee.js';
import { getJsonFromGithub } from './github.js';

export async function getAccountJson(env, path) {
  requireGiteeConfig(env);
  const current = await getFileFromGitee(env, path);
  if (current.content !== null && current.content !== undefined) return current;

  // Backward-compatible one-time migration for existing installations.
  if (env?.GITHUB_TOKEN && env?.GITHUB_OWNER && env?.GITHUB_REPO) {
    try {
      const legacy = await getJsonFromGithub(env, path);
      if (legacy.content !== null && legacy.content !== undefined) {
        await writeJsonToGitee(env, path, legacy.content, null, `migrate ${path} from GitHub to Gitee`);
        const confirmed = await getFileFromGitee(env, path);
        return { ...confirmed, migrated: true };
      }
    } catch (error) {
      // A failed legacy lookup must not turn into an empty account database.
      console.error('[account migration]', path, error?.message || error);
      throw new Error(`Gitee 中尚无 ${path}，且旧 GitHub 数据迁移失败：${error.message}`);
    }
  }
  return current;
}

export async function writeAccountJson(env, path, content, sha = null, message = 'update account data') {
  requireGiteeConfig(env);
  // If an earlier one-time migration returned no SHA (newly created/migrated file),
  // refresh the Gitee metadata before writing so updates use PUT rather than POST.
  let currentSha = sha;
  if (!currentSha) {
    const current = await getFileFromGitee(env, path);
    currentSha = current.sha || null;
  }
  return writeJsonToGitee(env, path, content, currentSha, message);
}
