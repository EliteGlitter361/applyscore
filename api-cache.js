/** Account-scoped cached reads with bounded requests and quiet background retries. */
(function (global) {
  'use strict';
  const PREFIX = 'apicache:v3:';
  const MAX_AGE = 300000;
  const REQUEST_TIMEOUT = 12000;
  const tracked = new Map();
  const inflight = new Map();
  const memory = new Map();
  const retries = new Map();
  let epoch = 0;

  const scope = options => new Headers(options?.fetchOpts?.headers || {}).get('Authorization')
    || [localStorage.getItem('adminToken'), localStorage.getItem('studentToken')].join('|');

  function read(key) {
    try {
      const entry = memory.get(key) || JSON.parse(sessionStorage.getItem(PREFIX + key) || 'null');
      if (entry && Date.now() - entry.at < MAX_AGE) {
        memory.set(key, entry);
        return entry;
      }
    } catch {}
    return null;
  }

  function save(key, data, ttl) {
    const at = Date.now();
    const entry = {data, at, expires: at + ttl};
    memory.set(key, entry);
    try { sessionStorage.setItem(PREFIX + key, JSON.stringify(entry)); } catch {}
  }

  function announce(url, data) {
    global.dispatchEvent?.(new CustomEvent('credit-api-updated', {detail:{url,data}}));
  }

  function fetchFresh(url, options, key, ttl) {
    if (inflight.has(key)) return inflight.get(key);
    const generation = epoch;
    const previous = read(key);
    const recovering = retries.has(key);
    const externalSignal = options.fetchOpts?.signal;
    const controller = global.AbortController ? new global.AbortController() : null;
    const cancel = () => controller?.abort();
    if (externalSignal?.aborted) cancel();
    else externalSignal?.addEventListener('abort', cancel, {once:true});
    let timedOut = false;
    const timer = controller ? setTimeout(() => { timedOut = true; cancel(); }, REQUEST_TIMEOUT) : null;

    const promise = (async () => {
      try {
        const response = await fetch(url, {
          ...options.fetchOpts, cache:'no-store',
          ...(controller ? {signal:controller.signal} : {})
        });
        if (!response.ok) {
          let message = 'HTTP ' + response.status;
          try { message = (await response.json()).error || message; } catch {}
          const error = new Error(message);
          error.status = response.status;
          if (response.status === 401 || response.status === 403) invalidatePrefix(url);
          throw error;
        }
        const data = await response.json();
        if (generation === epoch) {
          retries.delete(key);
          if (ttl > 0) {
            save(key, data, ttl);
            if (recovering || (previous && JSON.stringify(previous.data) !== JSON.stringify(data))) announce(url, data);
          }
        }
        return data;
      } catch (error) {
        if (generation === epoch && ttl > 0 && !externalSignal?.aborted) {
          const delay = Math.min((retries.get(key)?.delay || 2500) * 2, 60000);
          retries.set(key, {delay, at:Date.now() + delay});
        }
        if (timedOut) throw Error('网络响应超时，请稍后重试');
        throw error;
      }
    })().finally(() => {
      if (timer !== null) clearTimeout(timer);
      externalSignal?.removeEventListener('abort', cancel);
      if (inflight.get(key) === promise) inflight.delete(key);
    });
    inflight.set(key, promise);
    return promise;
  }

  function refreshIfDue(url, options, key, ttl, entry) {
    const now = Date.now();
    if (global.navigator?.onLine === false || (retries.get(key)?.at || 0) > now) return;
    if (entry && (entry.expires || entry.at + ttl) > now) return;
    fetchFresh(url, options, key, ttl).catch(() => {});
  }

  async function get(url, options = {}) {
    const ttl = Number.isFinite(options.ttl) ? Math.max(0, options.ttl) : 60000;
    const account = scope(options);
    const key = url + '::' + account;
    if (ttl > 0) tracked.set(key, {url, options, ttl, account});
    const entry = ttl > 0 ? read(key) : null;
    if (entry && !options.force) {
      refreshIfDue(url, options, key, ttl, entry);
      return entry.data;
    }
    return fetchFresh(url, options, key, ttl);
  }

  function invalidatePrefix(prefix) {
    epoch++;
    inflight.clear();
    for (const map of [memory, retries]) {
      for (const key of map.keys()) if (key.startsWith(prefix)) map.delete(key);
    }
    try {
      const keys = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(PREFIX + prefix) || key?.startsWith('apicache:v2:' + prefix)) keys.push(key);
      }
      keys.forEach(key => sessionStorage.removeItem(key));
    } catch {}
  }

  function clear() {
    invalidatePrefix('');
    tracked.clear();
  }

  function revalidate() {
    if (typeof document !== 'undefined' && document.hidden) return;
    for (const [key, entry] of tracked) {
      if (scope(entry.options) !== entry.account) continue;
      refreshIfDue(entry.url, entry.options, key, entry.ttl, read(key));
    }
  }

  global.apiCache = {get, invalidate:invalidatePrefix, invalidatePrefix, clear, revalidate};
  global.addEventListener?.('focus', revalidate);
  global.addEventListener?.('online', () => { retries.clear(); revalidate(); });
  global.addEventListener?.('pageshow', revalidate);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', revalidate);
  if (typeof setInterval === 'function') setInterval(revalidate, 5000);
})(window);
