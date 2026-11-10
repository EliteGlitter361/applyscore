/**
 * 跨标签页实时同步
 * - 写操作成功后调用 syncBus.emit('apps', {...})
 * - 其他标签页收到后自动 invalidate + 触发刷新回调
 * - 同一标签页内也可用 syncBus.on('apps', fn) 监听
 */
(function (global) {
  'use strict';

  const CHANNEL = 'xuefen-sync-v1';
  const STORAGE_KEY = '__xuefen_sync__';
  const useStorageFallback = typeof BroadcastChannel === 'undefined';

  let channel = null;
  const listeners = new Map();

  function emitLocal(key, payload) {
    const set = listeners.get(key);
    if (!set) return;
    set.forEach(fn => {
      try { fn(payload); } catch (e) { console.error(e); }
    });
  }

  function emit(key, payload) {
    emitLocal(key, payload);

    if (useStorageFallback) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          key, payload, ts: Date.now(), nonce: Math.random()
        }));
        localStorage.removeItem(STORAGE_KEY);
      } catch (e) {}
    } else {
      try {
        channel.postMessage({ key, payload, ts: Date.now() });
      } catch (e) {}
    }
  }

  function on(key, fn) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
    return () => off(key, fn);
  }

  function off(key, fn) {
    const set = listeners.get(key);
    if (set) set.delete(fn);
  }

  if (useStorageFallback) {
    window.addEventListener('storage', function (e) {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        const msg = JSON.parse(e.newValue);
        emitLocal(msg.key, msg.payload);
      } catch (err) {}
    });
  } else {
    channel = new BroadcastChannel(CHANNEL);
    channel.addEventListener('message', function (e) {
      if (!e.data) return;
      emitLocal(e.data.key, e.data.payload);
    });
  }

  global.syncBus = { emit, on, off };
})(window);