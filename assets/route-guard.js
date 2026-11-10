/**
 * Route checks run before Vue paints. Navigation deliberately never hides the
 * document root: Chromium/WebKit can save that inline style in the bfcache and
 * restore an invisible page after Android gesture / browser Back.
 */
(function (window, document) {
  'use strict';
  if (window.__musicEntering) return;
  const studentOnly = new Set(['/upload.html', '/messages.html', '/assigned-request.html','/file-upload.html']);
  const adminOnly = new Set(['/admin-tools.html','/dashboard.html', '/student.html', '/admin.html','/music.html']);
  const allowedReturns = new Set(['/home.html', '/index.html', '/upload.html', '/assigned-request.html', '/messages.html', '/assigned-request.html', '/detail.html', '/file-upload.html','/about.html','/settings.html']);
  let settingsRequest = null;
  let restorationId = 0;
  function getJSON(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch (_) { return null; }
  }
  function session(kind) {
    try {
      const token = localStorage.getItem(kind + 'Token');
      const user = getJSON(kind + 'User');
      if (!token || !user) return null;
      return kind === 'student'
        ? (user.studentId != null && String(user.studentId).trim() ? user : null)
        : (user.role === 'system' || user.role === 'admin' ? user : null);
    } catch (_) { return null; }
  }
  function localPath(raw, fallback) {
    if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || /[\\\x00-\x1f]/.test(raw)) return fallback;
    try {
      const url = new URL(raw, window.location.origin);
      return url.origin === window.location.origin && allowedReturns.has(url.pathname)
        ? url.pathname + url.search + url.hash : fallback;
    } catch (_) { return fallback; }
  }
  const normalizePath = path => path === '/' ? '/home.html' : path === '/upload' ? '/upload.html' : path;
  function studentLogin(target) {
    return '/student-login.html?redirect=' + encodeURIComponent(localPath(target, '/home.html'));
  }
  function destination(raw) {
    let url;
    try { url = new URL(raw, window.location.href); } catch (_) { return null; }
    if (url.origin !== window.location.origin) return null;
    const path = normalizePath(url.pathname);
    if (studentOnly.has(path) && path !== '/upload.html' && !(path==='/assigned-request.html'&&url.searchParams.has('studentId')) && !session('student')) return studentLogin(path + url.search + url.hash);
    const adminView = ['/home.html', '/about.html', '/settings.html'].includes(path) && url.searchParams.get('view') === 'admin';
    if (adminOnly.has(path) || adminView) {
      const admin = session('admin');
      if (!admin) return '/login.html';
      if ((path === '/admin.html' || path === '/music.html') && admin.role !== 'system') return '/dashboard.html';
      if (path === '/student.html' && admin.role === 'system') return '/admin.html?tab=students';
    }
    if ((path === '/detail.html' || path === '/assigned-request.html') && !url.searchParams.get('id')) return '/index.html';
    if (path === '/student-login.html') {
      let automatic = false;
      try { automatic = localStorage.getItem('studentAutoLogin') === 'true'; } catch (_) {}
      if (automatic && session('student')) return localPath(url.searchParams.get('redirect'), '/home.html');
    }
    return null;
  }
  function revokeSession(kind) {
    const token = localStorage.getItem(kind+'Token');
    if (!token?.startsWith('session-')) return;
    void fetch('/api/account-security?action=logout',{method:'POST',headers:{Authorization:'Bearer '+token},keepalive:true}).catch(()=>{});
  }
  function logoutAdmin() {
    if(window.__routeNavigationPending)return;
    try { revokeSession('admin'); } catch (_) {}
    try { localStorage.removeItem('adminToken'); localStorage.removeItem('adminUser'); localStorage.removeItem('aboutWriteToken'); } catch (_) {}
    try { window.apiCache?.clear(); } catch (_) {}
    navigateAway('/login.html', true);
    try { window.dispatchEvent(new Event('credit-auth-changed')); } catch (_) {}
  }
  function clearOldLeavingState() {
    // Clear all outgoing state on pagehide/pageshow so bfcache Back/Forward
    // never restores an invisible shell or leaves the next navigation unanimated.
    document.documentElement.style.visibility = '';
    document.documentElement.classList.remove('history-checking');
    if (document.body) document.body.classList.remove('page-leaving');
    window.__routeNavigationPending = false;
    window.__routeRedirecting = false;
  }
  function commitNavigation(target, replace) {
    if (replace) window.location.replace(target);
    else window.location.assign(target);
  }
  function navigateAway(target, replace) {
    if(window.__routeNavigationPending)return;
    window.__routeRedirecting=true;window.__routeNavigationPending=true;
    commitNavigation(target,replace);
  }
  function applicationDestination(settings) {
    if (settings.enabled === false) return '/close.html?msg=' + encodeURIComponent(settings.message || '学分申请入口已关闭') + (settings.entryClosedShowReturn === false ? '&hideReturn=1' : '');
    return null;
  }
  function statusDestination(settings) {
    if (settings.fileUploadEnabled === false) return '/close.html?msg=' + encodeURIComponent('文件上传功能已关闭');
    return null;
  }
  function clearFileSettings() {
    settingsRequest = null;
    window.__fileUploadSettings = null;
  }
  function fileSettings() {
    if (window.__fileUploadSettings) return Promise.resolve(window.__fileUploadSettings);
    if (!settingsRequest) {
      settingsRequest = (async () => {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeout = controller ? setTimeout(() => controller.abort(), 12000) : null;
        try {
          const res = await fetch('/api/settings', { cache: 'no-store', ...(controller ? { signal: controller.signal } : {}) });
          if (!res.ok) throw new Error('无法获取文件上传状态（HTTP ' + res.status + '）');
          const settings = await res.json();
          if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('文件上传状态无效');
          window.__fileUploadSettings = settings;
          return settings;
        } finally { if (timeout) clearTimeout(timeout); }
      })().catch(err => { settingsRequest = null; throw err; });
    }
    return settingsRequest;
  }
  function beforeVisit(raw) {
    const immediate = destination(raw);
    if (immediate) return Promise.resolve(immediate);
    let url;
    try { url = new URL(raw, window.location.href); } catch (_) { return Promise.resolve(null); }
    if (url.origin !== window.location.origin) return Promise.resolve(null);
    if (normalizePath(url.pathname) === '/upload.html') {
      // Never reuse upload-settings preflight cache for the application entrance.
      // The system account's newly saved enabled=false must take effect on the next click.
      clearFileSettings();
      return fileSettings().then(s => applicationDestination(s) || (!session('student') ? studentLogin('/upload.html' + url.search + url.hash) : null));
    }
    if (normalizePath(url.pathname) === '/file-upload.html') return fileSettings().then(statusDestination);
    if (normalizePath(url.pathname) === '/create-system.html') {
      return fetch('/api/admin/check-system', { cache: 'no-store' }).then(async res => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || typeof data.exists !== 'boolean') {
          throw new Error(data?.error || '系统初始化状态不可用');
        }
        return data.exists ? '/login.html' : null;
      });
    }
    return Promise.resolve(null);
  }
  function showChecking() {
    if (!document.body) return () => {};
    const node = document.createElement('div');
    node.className = 'route-checking';
    node.setAttribute('role', 'status');
    node.textContent = '正在检查服务状态…';
    document.body.appendChild(node);
    return () => node.remove();
  }
  window.CreditRouteGuard = { session, destination, beforeVisit, studentLogin, localPath, logoutAdmin, revokeSession,
    navigateAway, fileSettings, statusDestination, applicationDestination, clearFileSettings, clearOldLeavingState };

  const first = destination(window.location.href);
  if (first) { navigateAway(first, true); return; }
  const current = normalizePath(window.location.pathname);
  if (current === '/file-upload.html' || current === '/create-system.html' || current === '/upload.html') {
    window.__routePreflightPromise = beforeVisit(window.location.href);
    if (current === '/upload.html') window.__routePreflightPromise.then(target => {
      if (target && !(window.__inlineApplicationNotice && target.startsWith('/close.html?'))) navigateAway(target, true);
    }).catch(err => {
      console.warn('[application entrance preflight]', err);
      if (!window.__inlineApplicationNotice) navigateAway('/close.html?msg=' + encodeURIComponent('暂时无法确认学分申请入口状态，请稍后重试'), true);
    });
  }

  // Every entry to history, not just pageshow.persisted. Pagehide also clears
  // state BEFORE a page can be cached, covering Android edge/back gestures.
  window.addEventListener('pagehide', function () {
    restorationId++;
    clearOldLeavingState();
  });
  window.addEventListener('pageshow', function (event) {
    // A fast async controller may already have started a navigation before initial pageshow.
    if(!event.persisted && window.__routeNavigationPending)return;
    clearOldLeavingState();
    const where = destination(window.location.href);
    if (where) { navigateAway(where, true); return; }
    if (!event.persisted) return;
    if (!['/file-upload.html', '/create-system.html', '/upload.html'].includes(normalizePath(window.location.pathname))) return;
    const id = ++restorationId;
    if (['/file-upload.html', '/upload.html'].includes(normalizePath(window.location.pathname))) clearFileSettings();
    document.documentElement.classList.add('history-checking');
    const dismiss = normalizePath(window.location.pathname) === '/upload.html' ? () => {} : showChecking();
    beforeVisit(window.location.href).then(target => {
      if (id !== restorationId) return;
      if (target) navigateAway(target, true);
    }).catch(err => {
      console.warn('[history preflight]', err);
      window.flashError?.('服务状态暂时无法更新，请重试');
    }).finally(() => {
      dismiss();
      if (id === restorationId) document.documentElement.classList.remove('history-checking');
    });
  });
  // Handles same-document history changes; cross-document Back uses pageshow.
  window.addEventListener('popstate', function () {
    const where = destination(window.location.href);
    if (where) navigateAway(where, true);
    else clearOldLeavingState();
  });
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest && event.target.closest('a[href]');
    if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
    let url;
    try { url = new URL(anchor.href, window.location.href); } catch (_) { return; }
    if (url.origin !== window.location.origin) return;
    // Vue action anchors (e.g. system logout) must reach their own handler first.
    if (anchor.hasAttribute('data-nav-action') || anchor.hasAttribute('data-no-page-transition')) return;
    const path = normalizePath(url.pathname);
    // Hash-only and same-document jumps are not page navigations.
    if (path === normalizePath(window.location.pathname) &&
        url.search === window.location.search &&
        (url.hash || '') !== '' && url.hash !== window.location.hash) return;
    if (url.href === window.location.href) return;

    const immediate = destination(url.href);
    if (immediate) {
      event.preventDefault(); event.stopImmediatePropagation();
      navigateAway(immediate, false);
      return;
    }
    // Navigate immediately. The destination checks service availability once
    // while its shell is already visible and its form stays gated.
    // All other same-origin page links get the same exit transition.
    // Do not intercept downloads, external links, target=_blank or modified clicks.
    if (!url.pathname.toLowerCase().endsWith('.html') && url.pathname !== '/') return;
    event.preventDefault(); event.stopImmediatePropagation();
    navigateAway(url.pathname + url.search + url.hash, false);
  }, true);
})(window, document);
