// 编码/解码
function encodeBase64UTF8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
function decodeBase64UTF8(base64) {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

export async function getJsonFromGithub(env, filePath) {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = env;
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    throw new Error('Missing GITHUB_TOKEN, GITHUB_OWNER or GITHUB_REPO');
  }
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'cloudflare-pages',
    },
  });
  if (res.status === 404) {
    return { content: null, sha: null };
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error (${res.status}): ${text}`);
  }
  const data = await res.json();
  let content;
  try {
    content = JSON.parse(decodeBase64UTF8(data.content));
  } catch (e) {
    throw new Error(`Failed to parse JSON from GitHub: ${e.message}`);
  }
  return {
    content,
    sha: data.sha,
  };
}

export async function writeJsonToGithub(env, filePath, content, sha = null, message = 'update') {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = env;
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
  const jsonStr = JSON.stringify(content, null, 2);
  const base64Content = encodeBase64UTF8(jsonStr);
  const body = { message, content: base64Content };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'cloudflare-pages',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`GitHub write error (${res.status}): ${err.message}`);
  }
  return res.json();
}

// 以下函数目前未直接使用，但保留以备后续
export async function getRawFileContent(env, filePath) {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = env;
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'cloudflare-pages',
    },
  });
  if (!res.ok) throw new Error(`GitHub API error (${res.status})`);
  const data = await res.json();
  return data.content;
}

export async function writeFile(env, filePath, contentBase64, sha = null, message = 'upload') {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = env;
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
  const body = { message, content: contentBase64, encoding: 'base64' };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'cloudflare-pages',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`GitHub write file error (${res.status}): ${err.message}`);
  }
  return res.json();
}