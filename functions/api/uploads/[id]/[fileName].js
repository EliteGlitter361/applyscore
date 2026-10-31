import { getRawFileContentFromGitee } from '../../../utils/gitee';

// URL.pathname keeps percent-encoding. Files are stored in Gitee under their
// original sanitized UTF-8 names, so these route segments MUST be decoded.
function readSegment(segment) {
  try {
    const value = decodeURIComponent(segment || '');
    if (!value || value === '.' || value === '..' || /[\/\\\x00-\x1f]/.test(value)) return null;
    return value;
  } catch { return null; }
}

function jsonError(status, message, retryable = false) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  if (retryable) headers['Retry-After'] = '2';
  return new Response(JSON.stringify({ error: message, retryable }), { status, headers });
}

export async function onRequest({request, env}) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonError(405, '不支持此请求方式');
  }
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  if (segments.length !== 4 || segments[0] !== 'api' || segments[1] !== 'uploads') {
    return jsonError(404, '无效的文件地址');
  }
  const id = readSegment(segments[2]);
  const fileName = readSegment(segments[3]);
  if (!id || !fileName) return jsonError(400, '文件编号或文件名无效');

  try {
    const filePath = `data/uploads/${id}/${fileName}`;
    const base64Content = await getRawFileContentFromGitee(env, filePath);
    const binaryStr = atob(base64Content.replace(/\s/g, ''));
    const buffer = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) buffer[i] = binaryStr.charCodeAt(i);
    const ext = fileName.split('.').pop().toLowerCase();
    const mimeTypes = {
      png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg',
      gif:'image/gif', webp:'image/webp', pdf:'application/pdf',
      doc:'application/msword', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls:'application/vnd.ms-excel', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      zip:'application/zip', txt:'text/plain'
    };
    const headers = {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
    };
    return new Response(request.method === 'HEAD' ? null : buffer, {headers});
  } catch (error) {
    // Do not disguise rate limits/server errors as 404; callers can retry them.
    const raw = String(error?.message || '');
    const status = Number(raw.match(/\((\d{3})\)/)?.[1] || 0);
    console.error('[upload download]', { status, id, fileName, error: raw });
    if (status === 404) return jsonError(404, 'Gitee 中未找到此文件');
    if (status === 429) return jsonError(503, 'Gitee 请求受限，请稍后自动重试', true);
    if (status === 401 || status === 403) return jsonError(502, 'Gitee 拒绝访问，请检查令牌或仓库权限');
    return jsonError(502, '暂时无法从文件存储服务获取文件', true);
  }
}
