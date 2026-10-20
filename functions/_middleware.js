/**
 * Cloudflare Pages Functions 中间件
 * - GET /api/* 无鉴权 → 边缘缓存 3 秒（多用户共享同一次 Gitee 请求）
 * - GET /api/* 带鉴权 → 不缓存（保证权限数据实时）
 * - POST/PUT/DELETE → 不缓存
 */

const CACHE_TTL = 3;
const CACHE_PREFIX = 'apicache:v2:';

function getCacheKey(request) {
  const url = new URL(request.url);
  const params = new URLSearchParams(url.search);
  params.delete('t');
  params.delete('_');
  params.delete('ts');
  return CACHE_PREFIX + url.pathname + (params.toString() ? '?' + params.toString() : '');
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  if (!url.pathname.startsWith('/api/') || url.pathname === '/api/music' || url.pathname.startsWith('/api/music/')) {
    return next();
  }

  const method = request.method.toUpperCase();
  const hasAuth = request.headers.has('Authorization');
  const isGet = method === 'GET';

  // 写操作：放行，不缓存
  if (!isGet) {
    const response = await next();
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Cache-Control', 'no-store');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }

  // 初始化和公开关于信息均需要刷新后立即生效，不读取历史边缘缓存。
  if (url.pathname === '/api/admin/check-system' || url.pathname === '/api/about') {
    const response = await next();
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store, max-age=0');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  // 带鉴权 GET：不缓存
  if (hasAuth) {
    const response = await next();
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Cache-Control', 'private, no-cache, must-revalidate');
    newHeaders.set('Vary', 'Authorization');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }

  // 无鉴权 GET：走边缘缓存
  if (typeof caches !== 'undefined') {
    const cache = caches.default;
    const window = Math.floor(Date.now() / (CACHE_TTL * 1000));
    const cacheKey = getCacheKey(request) + ':' + window;
    const cacheRequest = new Request('https://cache.internal/' + cacheKey, {
      method: 'GET',
    });

    const cached = await cache.match(cacheRequest);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set('X-Cache', 'HIT');
      headers.set('Cache-Control', 'private, max-age=' + CACHE_TTL);
      return new Response(cached.body, { status: 200, headers });
    }

    const response = await next();
    if (response.ok) {
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'public, max-age=' + CACHE_TTL);
      const body = await response.clone().arrayBuffer();
      const toCache = new Response(body, { status: 200, headers });
      context.waitUntil(cache.put(cacheRequest, toCache.clone()));

      const outHeaders = new Headers(headers);
      outHeaders.set('X-Cache', 'MISS');
      return new Response(body, { status: 200, headers: outHeaders });
    }
    return response;
  }

  return next();
}