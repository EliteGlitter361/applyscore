/**
 * 全局操作反馈 + 页面过渡 + 加载遮罩 + UA 检测 + 选项卡横向滑动
 */
(function () {
  'use strict';

  /* ============================================
     零、UA 检测 & 移动端标记
     ============================================ */
  (function detectDevice() {
    const html = document.documentElement;
    const ua = navigator.userAgent || '';
    const maxTouch = navigator.maxTouchPoints || 0;
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|HarmonyOS|OpenHarmony|Symbian|Mobile/i.test(ua);
    // iPadOS 13+ UA 伪装为 Macintosh，靠触摸点判断
    const isIPadOS = /Macintosh/i.test(ua) && maxTouch > 1;
    const isTouch = 'ontouchstart' in window || maxTouch > 0;
    const isMobile = isMobileUA || isIPadOS;

    if (isMobile) html.classList.add('is-mobile');
    if (isIOS || isIPadOS) html.classList.add('is-ios');
    if (isAndroid) html.classList.add('is-android');
    if (isTouch) html.classList.add('is-touch');

    // 移动端地址栏收缩会导致 100vh 抖动，提供 --vh 变量
    const setVH = () => {
      html.style.setProperty('--vh', window.innerHeight * 0.01 + 'px');
    };
    setVH();
    window.addEventListener('resize', setVH, { passive: true });
    window.addEventListener('orientationchange', () => setTimeout(setVH, 120));
  })();

  /* Navigation is owned by the pre-render route guard and the browser.
     Do not intercept all links or fade out the whole body: history / BFCache
     otherwise restores an invisible page, and login redirects appear twice. */

  /* ============================================
     二、点击波纹（事件委托，覆盖动态元素）
     ============================================ */
  const RIPPLE_SELECTOR = [
    '.btn', '.refresh-btn', '.btn-submit', '.upload-cancel-btn',
    '.toggle-btn', '.tab-btn', '.submission-tab', '.login-btn',
    '.btn-back', '.app-card', '.msg-item', '.file-link',
    'button[type="submit"]'
  ].join(',');

  document.addEventListener('click', function (e) {
    const target = e.target.closest(RIPPLE_SELECTOR);
    if (!target || target.disabled) return;

    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ripple = document.createElement('span');
    ripple.className = 'ripple-effect';
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
    ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';

    const bg = getComputedStyle(target).backgroundColor || '';
    const m = bg.match(/\d+/g);
    const isDark = m && (Number(m[0]) * 0.299 + Number(m[1]) * 0.587 + Number(m[2]) * 0.114) < 180;
    ripple.style.background = isDark
      ? 'rgba(255,255,255,0.45)'
      : 'rgba(42,109,244,0.25)';

    if (getComputedStyle(target).position === 'static') {
      target.style.position = 'relative';
    }
    target.appendChild(ripple);
    setTimeout(() => ripple.remove(), 650);
  }, true);

  /* ============================================
     三、异步按钮 loading 包装
     ============================================ */
  window.withLoading = async function (btnOrSelector, task) {
    const btn = typeof btnOrSelector === 'string'
      ? document.querySelector(btnOrSelector)
      : btnOrSelector;
    if (!btn) return task();

    const original = btn.innerHTML;
    const originalDisabled = btn.disabled;
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.innerHTML = '<span class="loading-spinner"></span>' + original;
    try {
      return await task();
    } finally {
      btn.disabled = originalDisabled;
      btn.classList.remove('is-loading');
      btn.innerHTML = original;
    }
  };

  /* ============================================
     四、成功/失败脉冲
     ============================================ */
  window.pulseElement = function (el, type) {
    if (!el) return;
    const cls = type === 'error' ? 'pulse-error' : 'pulse-success';
    el.classList.remove('pulse-success', 'pulse-error');
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 950);
  };

  /* ============================================
     五、轻量浮动提示
     ============================================ */
  window.flashSuccess = function (message) {
    const el = document.createElement('div');
    el.className = 'flash-toast flash-success';
    el.innerHTML = '<span class="flash-icon"></span>' + message;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 400);
    }, 2200);
  };

  window.flashError = function (message) {
    const el = document.createElement('div');
    el.className = 'flash-toast flash-error';
    el.innerHTML = '<span class="flash-icon"></span>' + message;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 400);
    }, 2600);
  };

  /* ============================================
     六、全局加载遮罩
     ============================================ */
  let overlayEl = null;
  let overlayTextEl = null;
  let showCount = 0;

  function ensureOverlay() {
    if (overlayEl) return;
    overlayEl = document.createElement('div');
    overlayEl.className = 'loading-overlay';
    overlayEl.innerHTML = `
      <div class="loading-overlay-card">
        <div class="loading-overlay-spinner"></div>
        <div class="loading-overlay-text"></div>
      </div>
    `;
    document.body.appendChild(overlayEl);
    overlayTextEl = overlayEl.querySelector('.loading-overlay-text');
  }

  window.showLoadingOverlay = function (message) {
    ensureOverlay();
    showCount++;
    overlayTextEl.textContent = message || '正在处理...';
    void overlayEl.offsetWidth;
    overlayEl.classList.add('show');
  };

  window.hideLoadingOverlay = function () {
    if (!overlayEl) return;
    showCount = Math.max(0, showCount - 1);
    if (showCount === 0) {
      overlayEl.classList.remove('show');
    }
  };

  window.withOverlay = async function (message, task, minDuration = 500) {
    const startedAt = Date.now();
    showLoadingOverlay(message);
    try {
      const result = await task();
      const elapsed = Date.now() - startedAt;
      if (elapsed < minDuration) {
        await new Promise(r => setTimeout(r, minDuration - elapsed));
      }
      return result;
    } finally {
      hideLoadingOverlay();
    }
  };

  /* ============================================
     七、bfcache 兼容：清理残留的 page-leaving 状态
     ============================================ */
  window.addEventListener('pageshow', function (e) {
    document.body.classList.remove('page-leaving');
    if (e.persisted && window.apiCache) {
      try { apiCache.clear(); } catch (_) {}
    }
  });

  window.addEventListener('pagehide', function () {
    document.body.classList.remove('page-leaving');
  });

  /* ============================================
     八、选项卡横向滑动增强
     --------------------------------------------
     - 检测 .tabs 是否溢出，溢出时给 .tabs-wrap 加 has-overflow 类
     - 同步 at-start / at-end 标记（用于控制左右渐变提示）
     - 点击 tab 时若不可见，自动滚动到视口中央
     - 桌面端支持鼠标滚轮横滚
     - 兼容动态渲染的 tabs（MutationObserver）
     ============================================ */
  const TABS_ENHANCED = new WeakSet();

  function updateOverflowState(tabs, wrap) {
    const isOverflow = tabs.scrollWidth > tabs.clientWidth + 2;
    if (wrap) {
      wrap.classList.toggle('has-overflow', isOverflow);
      const atStart = tabs.scrollLeft <= 1;
      const atEnd = tabs.scrollLeft + tabs.clientWidth >= tabs.scrollWidth - 1;
      wrap.classList.toggle('at-start', atStart);
      wrap.classList.toggle('at-end', atEnd);
    }
  }

  function ensureVisible(tabs, btn) {
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const tr = tabs.getBoundingClientRect();
    if (r.left < tr.left || r.right > tr.right) {
      btn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
  }

  function enhanceTabs(tabs) {
    if (!tabs || TABS_ENHANCED.has(tabs)) return;
    TABS_ENHANCED.add(tabs);

    const wrap = tabs.closest('.tabs-wrap');
    const refresh = () => updateOverflowState(tabs, wrap);

    refresh();

    // 尺寸变化 → 重新检测
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(refresh);
      ro.observe(tabs);
    } else {
      window.addEventListener('resize', refresh);
    }
    // 窗口旋转、可视区域变化兜底
    window.addEventListener('resize', refresh);
    window.addEventListener('orientationchange', () => setTimeout(refresh, 120));

    // 滚动时更新左右两端标记
    tabs.addEventListener('scroll', refresh, { passive: true });

    // 点击 tab 后滚动到可见
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn, .submission-tab');
      if (!btn) return;
      requestAnimationFrame(() => {
        ensureVisible(tabs, btn);
        refresh();
      });
    });

    // 桌面端滚轮横滚（触摸设备天然支持滑动，无需处理）
    tabs.addEventListener('wheel', (e) => {
      if (tabs.scrollWidth <= tabs.clientWidth) return;
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        // 即时滚动，避免 smooth 造成滚轮粘滞
        tabs.scrollLeft += e.deltaY;
      }
    }, { passive: false });
  }

  function scanAndEnhanceTabs() {
    document.querySelectorAll('.tabs').forEach(enhanceTabs);
  }

  function initTabsEnhancement() {
    scanAndEnhanceTabs();

    // 动态新增 tabs（如某些页面异步生成）时自动增强
    if (window.MutationObserver) {
      let scheduled = false;
      const scheduleScan = () => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
          scheduled = false;
          scanAndEnhanceTabs();
        });
      };
      const mo = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (!m.addedNodes.length) continue;
          for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (
              (node.classList && node.classList.contains('tabs')) ||
              (node.querySelector && node.querySelector('.tabs'))
            ) {
              scheduleScan();
              return;
            }
          }
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTabsEnhancement);
  } else {
    initTabsEnhancement();
  }

})();