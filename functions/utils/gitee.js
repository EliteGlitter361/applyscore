// Gitee (码云) API v5 工具函数
// Pages Functions bindings are deployment settings. Never embed tokens into the client/ZIP.
export function requireGiteeConfig(env) {
  const required = ['GITEE_TOKEN', 'GITEE_OWNER', 'GITEE_REPO'];
  const missing = required.filter(key => typeof env?.[key] !== 'string' || !env[key].trim());
  if (missing.length) {
    const error = new Error('Cloudflare Pages 未配置 Gitee 环境变量：' + missing.join('、'));
    error.code = 'GITEE_CONFIG_MISSING';
    error.missing = missing;
    throw error;
  }
  return env;
}

function getHeaders(token) {
  return {
    'Authorization': `token ${token}`,
    'User-Agent': 'Mozilla/5.0 (compatible; Cloudflare-Pages)',
    'Accept': 'application/json',
  };
}

// 将 Base64 解码为 UTF-8 字符串
function base64ToUtf8(base64) {
  const raw = atob(base64.replace(/\s/g, ''));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

// 将 UTF-8 字符串编码为 Base64
function utf8ToBase64(str) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function giteeRateLimit(response) {
  if (response.status !== 429 && !(response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0')) return;
  const error = new Error('Gitee 请求过多');
  error.code = 'GITEE_RATE_LIMIT';
  const retry = response.headers.get('Retry-After');
  const seconds = /^\d+$/.test(retry || '') ? Number(retry) : Math.ceil((Date.parse(retry)-Date.now())/1000);
  error.retryAfter = Number.isFinite(seconds) && seconds > 0 ? seconds : 15;
  throw error;
}

export async function getFileFromGitee(env, filePath, {fresh = false} = {}) {
  const { GITEE_TOKEN, GITEE_OWNER, GITEE_REPO, GITEE_BRANCH = 'master' } = requireGiteeConfig(env);
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const url = `https://gitee.com/api/v5/repos/${encodeURIComponent(GITEE_OWNER)}/${encodeURIComponent(GITEE_REPO)}/contents/${encodedPath}?ref=${encodeURIComponent(GITEE_BRANCH)}`;
  const signal = AbortSignal.timeout(8000);
  const options = {headers:getHeaders(GITEE_TOKEN),signal};
  const res = await fetch(url, fresh || ['data/uploads.json','data/settings.json','data/account-sessions.json'].includes(filePath)
    ? {...options, cache:'no-store'} : options);
  giteeRateLimit(res);
  if (res.status === 404) {
    // A 404 from the contents endpoint can mean a genuinely absent file OR an
    // incorrect repository/branch. Never treat the latter as an empty database.
    // These files are the core credit system data. Optional first-use files
    // (music/about/messages) remain safely nullable without extra probes.
    if (!['data/app.json', 'data/settings.json', 'data/students.json', 'data/adminuser.json', 'data/loginlog.json'].includes(filePath)) {
      return { content: null, sha: null };
    }
    const base = `https://gitee.com/api/v5/repos/${encodeURIComponent(GITEE_OWNER)}/${encodeURIComponent(GITEE_REPO)}`;
    const repo = await fetch(base, options);
    if (!repo.ok) throw new Error(`Gitee 仓库不可访问（HTTP ${repo.status}），请检查 GITEE_OWNER/GITEE_REPO 和 Token 权限`);
    const branch = await fetch(base + `/branches/${encodeURIComponent(GITEE_BRANCH)}`, options);
    if (!branch.ok) throw new Error(`Gitee 分支不可访问（HTTP ${branch.status}），请检查 GITEE_BRANCH（当前配置 ${GITEE_BRANCH}）`);
    return { content: null, sha: null };
  }
  if (!res.ok) throw new Error(`Gitee 读取失败（HTTP ${res.status}），请检查 GITEE_TOKEN 权限及仓库/分支配置`);
  const data = await res.json();
  if (typeof data.sha !== 'string' || !data.sha.trim() || typeof data.content !== 'string') {
    throw new Error('Gitee 文件信息不完整，已停止保存，请稍后重试');
  }
  try {
    const jsonStr = base64ToUtf8(data.content);
    return { content: JSON.parse(jsonStr), sha: data.sha };
  } catch (e) {
    throw new Error(`解析 JSON 失败: ${e.message}`);
  }
}

export async function writeJsonToGitee(env, filePath, content, sha = null, message = 'update') {
  const { GITEE_TOKEN, GITEE_OWNER, GITEE_REPO, GITEE_BRANCH = 'master' } = requireGiteeConfig(env);
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const url = `https://gitee.com/api/v5/repos/${encodeURIComponent(GITEE_OWNER)}/${encodeURIComponent(GITEE_REPO)}/contents/${encodedPath}`;
  const jsonStr = JSON.stringify(content, null, 2);
  const base64Content = utf8ToBase64(jsonStr);
  const body = { access_token: GITEE_TOKEN, content: base64Content, message, branch: GITEE_BRANCH, sha };
  const method = sha ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; Cloudflare-Pages)' },
    body: JSON.stringify(body),
  });
  giteeRateLimit(res);
  if (!res.ok) {
    const conflict = res.status === 409 || res.status === 422;
    if (conflict) {
      const error = new Error('配置写入冲突或未通过校验，请刷新后重试');
      error.code = 'GITEE_WRITE_CONFLICT';
      throw error;
    }
    const error = new Error(`Gitee ${sha ? '更新' : '首次保存'}失败（HTTP ${res.status}）`);
    if (res.status === 429) error.code = 'GITEE_RATE_LIMIT';
    throw error;
  }
  return res.json();
}

// 写入二进制文件（截图、.kpx 等）
export async function writeFileToGitee(env, filePath, base64Content, sha = null, message = 'upload') {
  const { GITEE_TOKEN, GITEE_OWNER, GITEE_REPO, GITEE_BRANCH = 'master' } = requireGiteeConfig(env);
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const url = `https://gitee.com/api/v5/repos/${encodeURIComponent(GITEE_OWNER)}/${encodeURIComponent(GITEE_REPO)}/contents/${encodedPath}`;
  const body = { access_token: GITEE_TOKEN, content: base64Content, message, branch: GITEE_BRANCH, sha };
  const method = sha ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; Cloudflare-Pages)' },
    body: JSON.stringify(body),
  });
  giteeRateLimit(res);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gitee 写入文件失败 (${res.status}): ${err}`);
  }
  return res.json();
}

// 获取原始文件（用于图片展示）
export async function getRawFileContentFromGitee(env, filePath) {
  const { GITEE_TOKEN, GITEE_OWNER, GITEE_REPO, GITEE_BRANCH = 'master' } = requireGiteeConfig(env);
  // Encode each path component separately: keep / separators while preserving
  // Chinese names, %, #, ?, spaces and other valid filename characters.
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const url = `https://gitee.com/api/v5/repos/${encodeURIComponent(GITEE_OWNER)}/${encodeURIComponent(GITEE_REPO)}/contents/${encodedPath}?ref=${encodeURIComponent(GITEE_BRANCH)}`;
  const res = await fetch(url, { headers: getHeaders(GITEE_TOKEN) });
  if (!res.ok) throw new Error(`获取文件失败 (${res.status})`);
  const data = await res.json();
  if (!data.content) throw new Error('文件内容为空');
  return data.content; // 原始 base64
}