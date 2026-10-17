/** Vue 3 page controller — index.
 * Mounted by the Vue PageContent component; API operations remain unchanged.
 * Business DOM fragments from the pre-Vue project are preserved for compatibility.
 */
export function mount() {

    let currentTab = 'pending';
    let currentSearchTerm = '';
    let unreadTimer = null;
    let isFirstLoad = true;
    let lastUnreadCount = 0;
    let knownMessageIds = new Set();
    let isPageVisible = true;
    let isRequesting = false;

    /* ===== 轮询策略（结合边缘缓存后的激进版本） ===== */
    let unreadPollInterval = 8000;
    let unreadEmptyStreak = 0;
    const POLL_FAST = 8000;
    const POLL_SLOW = 15000;
    const STREAK_TO_SLOW = 6;

    /* ===== 缓存 TTL（边缘缓存 3s，本地缓存可进一步降到 5s） ===== */
    const TTL = {
      settings: 60000,
      apps: 5000,
      messages: 0,
    };

    const LOCK_SVG = `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2"/>
      <path d="M8 11V7a4 4 0 0 1 8 0v4"/>
    </svg>`;

    function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

    function renderNav() {
      const nav = document.getElementById('navActions');
      const token = localStorage.getItem('studentToken');
      const userStr = localStorage.getItem('studentUser');
      let user = null;
      try { user = userStr ? JSON.parse(userStr) : null; } catch (e) {}

      // 首页不再重复渲染提交申请、文件上传、消息、登录和管理后台入口。
      // 这些入口由 Vue 侧边栏/手机导航统一提供；此处仅保留账户独有操作。
      let html = '';
      if (token && user) {
        html = `
          <div class="user-menu-wrapper">
            <button type="button" class="user-badge" id="userBadge" onclick="toggleUserDropdown(event)" aria-label="账户操作菜单">
              <span class="dot"></span>
              <span>${escapeHtml(user.name || '')} · ${escapeHtml(user.studentId || '')}</span>
              <span class="caret">▼</span>
            </button>
            <div class="user-dropdown" id="userDropdown">
              <div class="user-dropdown-item" role="button" tabindex="0" onclick="openChangePassword()">修改密码</div>
              <div class="user-dropdown-divider"></div>
              <div class="user-dropdown-item danger" role="button" tabindex="0" onclick="studentLogout()">退出登录</div>
            </div>
          </div>
        `;
      }
      nav.innerHTML = html;

      if (token && user) loadUnreadCount();
    }

    async function loadUnreadCount() {
      const token = localStorage.getItem('studentToken');
      const userStr = localStorage.getItem('studentUser');
      if (!token || !userStr) return false;
      if (!isPageVisible) return false;
      if (isRequesting) return false;
      isRequesting = true;

      let user = null;
      try { user = JSON.parse(userStr); } catch (e) { isRequesting = false; return false; }
      if (!user || !user.studentId) { isRequesting = false; return false; }

      let hasNew = false;
      try {
        const messages = await apiCache.get(
          '/api/messages?studentId=' + encodeURIComponent(user.studentId),
          { ttl: TTL.messages }
        );
        const unreadMessages = messages.filter(m => !m.read);
        const unread = unreadMessages.length;

        // 侧边栏与手机底部导航共用未读状态，避免第二个“消息”按钮。
        const badges = document.querySelectorAll('[data-message-badge]');
        if (lastUnreadCount !== unread) {
          badges.forEach(badge => {
            if (unread > 0) {
              badge.textContent = unread > 99 ? '99+' : String(unread);
              badge.classList.remove('hidden');
            } else {
              badge.classList.add('hidden');
            }
          });
          lastUnreadCount = unread;
        }

        if (isFirstLoad) {
          unreadMessages.forEach(m => knownMessageIds.add(m.id));
          isFirstLoad = false;
          isRequesting = false;
          return false;
        }

        const newMessages = unreadMessages.filter(m => !knownMessageIds.has(m.id));
        if (newMessages.length > 0) {
          hasNew = true;
          newMessages.sort((a, b) => b.createdAt - a.createdAt);
          newMessages.slice(0, 3).forEach(m => showMessageToast(m));
        }
        unreadMessages.forEach(m => knownMessageIds.add(m.id));

        if (knownMessageIds.size > 200) {
          const ids = Array.from(knownMessageIds);
          knownMessageIds = new Set(ids.slice(-200));
        }
      } catch (e) {}
      isRequesting = false;
      return hasNew;
    }

    function showMessageToast(msg) {
      const container = document.getElementById('messageToastContainer');
      if (!container) return;
      if (container.children.length >= 3) {
        const first = container.firstElementChild;
        if (first) first.remove();
      }
      const typeClass = msg.type || 'system';
      const preview = (msg.content || '').replace(/\n/g, ' ').substring(0, 80);
      const toast = document.createElement('div');
      toast.className = 'message-toast ' + typeClass;
      toast.innerHTML = `
        <div class="toast-header">
          <span class="toast-title">${escapeHtml(msg.title || '新消息')}</span>
          <span class="toast-time">刚刚</span>
        </div>
        <div class="toast-content">${escapeHtml(preview)}${preview.length >= 80 ? '...' : ''}</div>
      `;
      toast.addEventListener('click', () => { window.location.href = '/messages.html'; });
      container.appendChild(toast);
      setTimeout(() => {
        toast.classList.add('closing');
        setTimeout(() => { if (toast.parentElement) toast.remove(); }, 400);
      }, 5000);
    }

    function startUnreadTimer() {
      if (unreadTimer) clearTimeout(unreadTimer);

      const loop = async () => {
        if (isPageVisible) {
          const hadNew = await loadUnreadCount();
          if (hadNew) {
            unreadEmptyStreak = 0;
            unreadPollInterval = POLL_FAST;
          } else {
            unreadEmptyStreak++;
            if (unreadEmptyStreak >= STREAK_TO_SLOW) {
              unreadPollInterval = POLL_SLOW;
            }
          }
        }
        unreadTimer = setTimeout(loop, unreadPollInterval);
      };

      unreadTimer = setTimeout(loop, 3000);
    }

    document.addEventListener('visibilitychange', function () {
      isPageVisible = !document.hidden;
      if (isPageVisible) {
        unreadEmptyStreak = 0;
        unreadPollInterval = POLL_FAST;
        loadUnreadCount();
      }
    });
    window.addEventListener('focus', function () { isPageVisible = true; loadUnreadCount(); });
    window.addEventListener('blur', function () { isPageVisible = false; });

    /* ===== syncBus：其他标签页的写操作立即刷新本页 ===== */
    if (window.syncBus) {
      syncBus.on('apps', function () {
        apiCache.invalidate('/api/apps');
        refreshCurrentTab(currentSearchTerm);
      });
      syncBus.on('messages', function () {
        apiCache.invalidatePrefix('/api/messages');
        loadUnreadCount();
      });
      syncBus.on('students', function () {
        apiCache.invalidate('/api/students');
      });
    }

    function toggleUserDropdown(e) {
      e.stopPropagation();
      const badge = document.getElementById('userBadge');
      const dropdown = document.getElementById('userDropdown');
      const isOpen = dropdown.classList.contains('show');
      if (isOpen) {
        dropdown.classList.remove('show');
        badge.classList.remove('open');
      } else {
        dropdown.classList.add('show');
        badge.classList.add('open');
      }
    }

    document.addEventListener('click', function (e) {
      const wrapper = document.querySelector('.user-menu-wrapper');
      if (wrapper && !wrapper.contains(e.target)) {
        const dropdown = document.getElementById('userDropdown');
        const badge = document.getElementById('userBadge');
        if (dropdown) dropdown.classList.remove('show');
        if (badge) badge.classList.remove('open');
      }
    });

    function openChangePassword() {
      const dropdown = document.getElementById('userDropdown');
      const badge = document.getElementById('userBadge');
      if (dropdown) dropdown.classList.remove('show');
      if (badge) badge.classList.remove('open');

      showPrompt('修改密码', '请输入当前密码：', '', '当前密码', '下一步', '取消', function (oldPwd) {
        if (oldPwd === null) return;
        if (!oldPwd) { flashError('请输入当前密码'); return; }
        showPrompt('修改密码', '请输入新密码（至少6位）：', '', '新密码', '确定', '取消', async function (newPwd) {
          if (newPwd === null) return;
          if (!newPwd || newPwd.length < 6) { flashError('新密码至少6位'); return; }
          showPrompt('修改密码', '请再次输入新密码：', '', '确认新密码', '确定', '取消', async function (confirmPwd) {
            if (confirmPwd === null) return;
            if (newPwd !== confirmPwd) { flashError('两次输入的新密码不一致'); return; }
            const userStr = localStorage.getItem('studentUser');
            let user = null;
            try { user = JSON.parse(userStr); } catch (e) {}
            if (!user) { flashError('用户信息错误'); return; }
            try {
              const res = await fetch('/api/students?action=change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studentId: user.studentId, oldPassword: oldPwd, newPassword: newPwd })
              });
              const data = await res.json();
              if (!res.ok) { flashError(data.error || '修改失败'); return; }
              flashSuccess('密码修改成功');
            } catch (e) { flashError('网络错误，请稍后重试'); }
          });
        });
      });
    }

    function studentLogout() {
      const dropdown = document.getElementById('userDropdown');
      const badge = document.getElementById('userBadge');
      if (dropdown) dropdown.classList.remove('show');
      if (badge) badge.classList.remove('open');
      showConfirm('确认退出', '确定要退出登录吗？', '确定', '取消', function (confirmed) {
        if (!confirmed) return;
        localStorage.removeItem('studentToken');
        localStorage.removeItem('studentUser');
        localStorage.removeItem('studentAutoLogin');
        if (unreadTimer) { clearTimeout(unreadTimer); unreadTimer = null; }
        knownMessageIds.clear();
        isFirstLoad = true;
        lastUnreadCount = 0;
        if (window.apiCache) apiCache.clear();
        document.querySelectorAll('[data-message-badge]').forEach(el => { el.textContent = '0'; el.classList.add('hidden'); });
        window.dispatchEvent(new Event('credit-auth-changed'));
        renderNav();
        flashSuccess('已退出登录');
      });
    }

    (async function () {
      try {
        const settings = await apiCache.get('/api/settings', { ttl: TTL.settings });
        if (settings.announcementEnabled && settings.announcementMessage) {
          setTimeout(() => {
            if (typeof showAlert === 'function') {
              showAlert(settings.announcementTitle || '系统公告', settings.announcementMessage, '我知道了', null, { textAlign: 'left' });
            }
          }, 300);
        }
      } catch (e) {}
    })();

    function createAppCard(app, isNeedsFix = false) {
      const card = document.createElement('a');
      card.className = 'app-card';
      card.href = `/detail.html?id=${encodeURIComponent(app.id)}`;

      const title = document.createElement('div');
      title.className = 'app-title';
      title.textContent = app.versionName || '未命名活动';

      const student = document.createElement('div');
      student.className = 'app-student';
      student.textContent = `${app.name || '未知'} · ${app.packageName || ''}`;

      const meta = document.createElement('div');
      meta.className = 'app-meta';
      const tag = document.createElement('span');
      tag.className = 'tag time';
      tag.textContent = app.publisher || '';
      meta.appendChild(tag);
      if (isNeedsFix) {
        const tag2 = document.createElement('span');
        tag2.className = 'tag rejected';
        tag2.textContent = '需要修改';
        meta.appendChild(tag2);
      }

      card.appendChild(title);
      card.appendChild(student);
      card.appendChild(meta);

      if (isNeedsFix && app.rejectReason) {
        const reason = document.createElement('p');
        reason.style.cssText = 'font-size:13px;color:#991b1b;margin-top:6px;padding:8px 12px;background:#fef2f2;border-radius:10px;line-height:1.5;';
        reason.textContent = '驳回原因：' + app.rejectReason;
        card.appendChild(reason);
      }
      return card;
    }

    async function loadApprovedApps(term = '', manual = false) {
      const grid = document.getElementById('appGridPending');
      try {
        const allApps = await apiCache.get('/api/apps', { ttl: TTL.apps });
        let apps = allApps.filter(a => a.status === 'approved');
        if (term.trim()) {
          const t = term.trim().toLowerCase();
          apps = apps.filter(a =>
            (a.name || '').toLowerCase().includes(t) ||
            (a.packageName || '').toLowerCase().includes(t) ||
            (a.versionName || '').toLowerCase().includes(t)
          );
        }
        if (apps.length === 0) {
          grid.innerHTML = '<div class="empty-state">暂无待发放的学分</div>';
          return;
        }
        const fragment = document.createDocumentFragment();
        apps.forEach(app => fragment.appendChild(createAppCard(app, false)));
        grid.innerHTML = '';
        grid.appendChild(fragment);
      } catch (e) {
        grid.innerHTML = `<div class="empty-state" style="color:red">加载失败：${escapeHtml(e.message)}</div>`;
        if (manual) throw e;
      }
    }

    async function loadNeedsFixApps(term = '', manual = false) {
      const grid = document.getElementById('appGridFix');
      const token = localStorage.getItem('studentToken');
      const userStr = localStorage.getItem('studentUser');
      let user = null;
      try { user = userStr ? JSON.parse(userStr) : null; } catch (e) {}

      if (!token || !user) {
        grid.innerHTML = `
          <div class="login-prompt">
            <div class="icon">${LOCK_SVG}</div>
            <h3>您还未登录</h3>
            <p>登录后可以查看需要修改的学分</p>
            <a href="/student-login.html?redirect=${encodeURIComponent('/index.html')}" class="login-btn">立即登录</a>
          </div>
        `;
        return;
      }
      try {
        const allApps = await apiCache.get('/api/apps', { ttl: TTL.apps });
        let apps = allApps.filter(a => a.status === 'needs_fix' && String(a.packageName) === String(user.studentId));
        if (term.trim()) {
          const t = term.trim().toLowerCase();
          apps = apps.filter(a =>
            (a.name || '').toLowerCase().includes(t) ||
            (a.packageName || '').toLowerCase().includes(t) ||
            (a.versionName || '').toLowerCase().includes(t)
          );
        }
        if (apps.length === 0) {
          grid.innerHTML = '<div class="empty-state">暂无需要修改的学分</div>';
          return;
        }
        const fragment = document.createDocumentFragment();
        apps.forEach(app => fragment.appendChild(createAppCard(app, true)));
        grid.innerHTML = '';
        grid.appendChild(fragment);
      } catch (e) {
        grid.innerHTML = `<div class="empty-state" style="color:red">加载失败：${escapeHtml(e.message)}</div>`;
        if (manual) throw e;
      }
    }

    function refreshCurrentTab(term = '', force = false) {
      if (force && window.apiCache) apiCache.invalidate('/api/apps');
      if (currentTab === 'pending') return loadApprovedApps(term, force);
      else if (currentTab === 'needs-fix') return loadNeedsFixApps(term, force);
      return Promise.resolve();
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        if (this.classList.contains('active')) return;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        const tab = this.dataset.tab;
        currentTab = tab;
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
        document.getElementById('tab-' + tab).classList.add('active');
        refreshCurrentTab(currentSearchTerm);
      });
    });

    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', function () {
      currentSearchTerm = this.value;
      clearTimeout(this._timer);
      this._timer = setTimeout(() => refreshCurrentTab(currentSearchTerm), 300);
    });

    document.getElementById('refreshBtn').addEventListener('click', function () {
      searchInput.value = '';
      currentSearchTerm = '';
      return window.CreditRefresh.run(this, () => refreshCurrentTab('', true));
    });

    renderNav();
    loadApprovedApps();
    startUnreadTimer();
  
    window.escapeHtml = escapeHtml;
    window.renderNav = renderNav;
    window.loadUnreadCount = loadUnreadCount;
    window.showMessageToast = showMessageToast;
    window.startUnreadTimer = startUnreadTimer;
    window.toggleUserDropdown = toggleUserDropdown;
    window.openChangePassword = openChangePassword;
    window.studentLogout = studentLogout;
    window.createAppCard = createAppCard;
    window.loadApprovedApps = loadApprovedApps;
    window.loadNeedsFixApps = loadNeedsFixApps;
    window.refreshCurrentTab = refreshCurrentTab;

    return () => { if (unreadTimer) clearTimeout(unreadTimer); };
}
