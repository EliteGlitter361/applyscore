/**
 * 轻量级 API 缓存工具
 * - sessionStorage 做跨页面缓存
 * - TTL 控制新鲜度
 * - 并发去重（同 URL 只发一次）
 * - invalidate / invalidatePrefix / clear 保证写后即失效
 */
(function (global) {
  'use strict';

  const PREFIX = 'apicache:v2:';
  const DEFAULT_TTL = 30000;      // 默认 30 秒
  const inflight = new Map();

  const key = url => PREFIX + url;

  function readCache(url) {
    try {
      const raw = sessionStorage.getItem(key(url));
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (!entry || typeof entry.expires !== 'number') return null;
      if (entry.expires < Date.now()) {
        sessionStorage.removeItem(key(url));
        return null;
      }
      return entry.data;
    } catch { return null; }
  }

  function writeCache(url, data, ttl) {
    if (ttl <= 0) return;
    try {
      sessionStorage.setItem(key(url), JSON.stringify({
        data, expires: Date.now() + ttl,
      }));
    } catch {
      // 空间满：清掉一半旧条目后重试
      try {
        const keys = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith(PREFIX)) keys.push(k);
        }
        keys.slice(0, Math.max(1, Math.floor(keys.length / 2)))
            .forEach(k => sessionStorage.removeItem(k));
        sessionStorage.setItem(key(url), JSON.stringify({
          data, expires: Date.now() + ttl,
        }));
      } catch {}
    }
  }

  /**
   * 缓存版 fetch → Promise<json>
   * @param {string} url
   * @param {object} [options]
   *   - ttl: 缓存毫秒数，0 = 不缓存（默认 30 秒）
   *   - force: true = 强制绕过缓存重新请求
   *   - fetchOpts: 传给原生 fetch 的配置（headers 等）
   */
  async function get(url, options = {}) {
    const ttl = options.ttl !== undefined ? options.ttl : DEFAULT_TTL;
    const force = options.force === true;

    if (!force && ttl > 0) {
      const cached = readCache(url);
      if (cached !== null) return cached;
    }

    if (!force && inflight.has(url)) return inflight.get(url);

    const promise = (async () => {
      const res = await fetch(url, options.fetchOpts || {});
      if (!res.ok) {
        let msg = 'HTTP ' + res.status;
        try { msg = (await res.json()).error || msg; } catch {}
        const err = new Error(msg);
        err.status = res.status;
        throw err;
      }
      const data = await res.json();
      writeCache(url, data, ttl);
      return data;
    })().finally(() => inflight.delete(url));

    if (!force) inflight.set(url, promise);
    return promise;
  }

  function invalidate(url) {
    try { sessionStorage.removeItem(key(url)); } catch {}
  }

  function invalidatePrefix(prefix) {
    const rm = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(PREFIX + prefix)) rm.push(k);
    }
    rm.forEach(k => sessionStorage.removeItem(k));
  }

  function clear() {
    const rm = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(PREFIX)) rm.push(k);
    }
    rm.forEach(k => sessionStorage.removeItem(k));
  }

  global.apiCache = { get, invalidate, invalidatePrefix, clear };
})(window);