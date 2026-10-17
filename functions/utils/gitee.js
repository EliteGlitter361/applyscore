// Gitee (码云) API v5 工具函数
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

export async function getFileFromGitee(env, filePath) {
  const { GITEE_TOKEN, GITEE_OWNER, GITEE_REPO, GITEE_BRANCH = 'master' } = env;
  const url = `https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/contents/${filePath}?ref=${GITEE_BRANCH}`;
  const res = await fetch(url, { headers: getHeaders(GITEE_TOKEN) });
  if (res.status === 404) return { content: null, sha: null };
  if (!res.ok) throw new Error(`Gitee 读取失败 (${res.status})`);
  const data = await res.json();
  if (!data.content) return { content: null, sha: null };
  try {
    const jsonStr = base64ToUtf8(data.content);
    return { content: JSON.parse(jsonStr), sha: data.sha };
  } catch (e) {
    throw new Error(`解析 JSON 失败: ${e.message}`);
  }
}

export async function writeJsonToGitee(env, filePath, content, sha = null, message = 'update') {
  const { GITEE_TOKEN, GITEE_OWNER, GITEE_REPO, GITEE_BRANCH = 'master' } = env;
  const url = `https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/contents/${filePath}`;
  const jsonStr = JSON.stringify(content, null, 2);
  const base64Content = utf8ToBase64(jsonStr);
  const body = { access_token: GITEE_TOKEN, content: base64Content, message, branch: GITEE_BRANCH, sha };
  const method = sha ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; Cloudflare-Pages)' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gitee 写入失败 (${res.status}): ${err}`);
  }
  return res.json();
}

// 写入二进制文件（截图、.kpx 等）
export async function writeFileToGitee(env, filePath, base64Content, sha = null, message = 'upload') {
  const { GITEE_TOKEN, GITEE_OWNER, GITEE_REPO, GITEE_BRANCH = 'master' } = env;
  const url = `https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/contents/${filePath}`;
  const body = { access_token: GITEE_TOKEN, content: base64Content, message, branch: GITEE_BRANCH, sha };
  const method = sha ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; Cloudflare-Pages)' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gitee 写入文件失败 (${res.status}): ${err}`);
  }
  return res.json();
}

// 获取原始文件（用于图片展示）
export async function getRawFileContentFromGitee(env, filePath) {
  const { GITEE_TOKEN, GITEE_OWNER, GITEE_REPO, GITEE_BRANCH = 'master' } = env;
  const url = `https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/contents/${filePath}?ref=${GITEE_BRANCH}`;
  const res = await fetch(url, { headers: getHeaders(GITEE_TOKEN) });
  if (!res.ok) throw new Error(`获取文件失败 (${res.status})`);
  const data = await res.json();
  if (!data.content) throw new Error('文件内容为空');
  return data.content; // 原始 base64
}