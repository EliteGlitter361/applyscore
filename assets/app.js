/** 学分申请系统 · Vue 3 page controllers and rendering (2026). */
(() => {
  'use strict';
  if (window.__routeRedirecting) return; // preflight already redirected, never mount a protected view
  const page = document.documentElement.dataset.page || 'index';
  const titles = {
    index: '学分总览', upload: '提交申请', detail: '申请详情', 'file-upload': '文件上传',
    messages: '我的消息', 'student-login': '学生登录', login: '管理员登录',
    'create-system': '系统初始化', close: '系统通知', dashboard: '审核工作台',
    admin: '系统管理', student: '学生管理', about: '关于'
  };
  const authPages = new Set(['student-login', 'login', 'create-system', 'close']);
  const adminPages = new Set(['dashboard', 'student', 'admin']);
  const isAuth = authPages.has(page);
  const adminArea = adminPages.has(page) || (page === 'about' && new URLSearchParams(location.search).get('view') === 'admin' && !!localStorage.getItem('adminToken'));
  const navStudent = [
    { href: '/index.html', title: '学分总览', icon: '◫', pages: ['index','detail'] },
    { href: '/upload.html', title: '提交申请', icon: '＋', pages: ['upload'] },
    { href: '/file-upload.html', title: '文件上传', icon: '⇧', pages: ['file-upload'] },
    { href: '/messages.html', title: '我的消息', icon: '✉', pages: ['messages'] },
    { href: '/student-login.html', title: '学生登录', icon: '♙', pages: ['student-login'] },
    { href: '/login.html', title: '管理后台', icon: '▦', pages: ['login'] },
    { href: '/about.html', title: '关于', icon: 'ⓘ', pages: ['about'] }
  ];
  const navAdmin = [
    { href: '/dashboard.html', title: '审核工作台', icon: '☷', pages: ['dashboard'] },
    { href: '/student.html', title: '学生管理', icon: '♧', pages: ['student'] },
    { href: '/admin.html', title: '系统管理', icon: '⚙', pages: ['admin'] },
    { href: '/index.html', title: '返回学生端', icon: '↗', pages: ['index'] },
    { href: '/about.html?view=admin', title: '关于', icon: 'ⓘ', pages: ['about'] }
  ];
  const safeGet = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const safeJSON = key => { try { return JSON.parse(safeGet(key) || '{}'); } catch { return {}; } };
  const media = window.matchMedia('(max-width: 820px)');
  // Match the CSS breakpoint rather than UA-only widths: avoids mismatched tablet layouts.
  const uaIsMobile = /Android|iPhone|iPod|Mobile|Windows Phone/i.test(navigator.userAgent);
  function injectScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url; script.async = false;
      script.onload = resolve; script.onerror = () => reject(new Error('资源加载失败：' + url));
      document.head.appendChild(script);
    });
  }
  window.__loadScript = injectScript;
  if (window.syncBus?.on) window.syncBus.on('settings', () => window.CreditRouteGuard?.clearFileSettings());
  // XLSX is an optional spreadsheet module, downloaded only when importing or exporting.
  // JSZip is vendored and loads on demand. The main application has no external CDN dependency.
  let spreadsheetPromise;
  function loadSpreadsheet() {
    if (window.XLSX) return Promise.resolve();
    if (!spreadsheetPromise) {
      spreadsheetPromise = (async () => {
        if (!window.JSZip) await injectScript('/vendor/jszip.min.js');
        if (!window.pako) await injectScript('/vendor/pako.min.js');
        try { await injectScript('/vendor/xlsx-compat.js'); } catch (e) { /* optional CDN fallback */ }
        if (!window.XLSX) {
          try { await injectScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'); }
          catch (e) { throw new Error('Excel 组件加载失败，请检查网络'); }
        }
      })().catch(e => { spreadsheetPromise = null; throw e; });
    }
    return spreadsheetPromise;
  }
  const { createApp, ref, onMounted, onBeforeUnmount, computed } = window.Vue || {};
  if (!createApp) {
    document.getElementById('app').innerHTML = '<div class="fatal-error">无法加载 Vue 3 运行环境，请刷新后重试。</div>';
    return;
  }
  const PageContent = {
    name: 'PageContent',
    template: document.getElementById('page-template').innerHTML,
    data() {
      return {
        isSystem: adminArea && safeJSON('adminUser').role === 'system',
        closeMessage: new URLSearchParams(window.location.search).get('msg'),
        initialStudentsTab: page === 'admin' && new URLSearchParams(window.location.search).get('tab') === 'students',
        activeTab: page === 'admin' && ['admins','students','messages','tools','files','maintenance','logs','about'].includes(new URLSearchParams(window.location.search).get('tab')) ? new URLSearchParams(window.location.search).get('tab') : 'admins',
        username: '', studentId: '', password: '', confirmPassword: '', autoLogin: true,
        loginError: '', loginPending: false, systemStatus: 'checking', setupSuccess: '',
        adminRows: null, adminListError: '',
        aboutInfo: {title:'',subtitle:'',description:'',organization:'',version:'',contactEmail:'',website:''},
        aboutUpdatedAt: null, aboutStatus: 'loading', aboutError: '', aboutSaving: false, aboutSaveResult: '',
        adminProgress: {open:false, busy:false, outcome:'', title:'', detail:'', percent:0, indeterminate:true},
        uploadModalOpen: false, uploadModalProgress: 0, uploadModalState: 'uploading', uploadModalError: ''
      };
    },
    methods: {
      goHome() { window.location.assign('/index.html'); },
      updateUploadProgress(state, progress = 0, error = '') {
        this.uploadModalOpen = true;
        this.uploadModalState = state;
        this.uploadModalProgress = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
        this.uploadModalError = error || '';
      },
      dismissUploadError() {
        if (this.uploadModalState === 'error') this.uploadModalOpen = false;
      },
      reportAdminProgress(state = {}) {
        if (page !== 'admin') return;
        if (state.type === 'start') {
          if (this.adminProgress.busy) return;
          this.adminProgress = {open:true, busy:true, outcome:'', title:state.title || '正在处理…',
            detail:state.detail || '正在连接服务器，请勿离开页面', percent:0,
            indeterminate:state.indeterminate !== false};
          this.$nextTick(() => document.querySelector('.admin-progress-dialog')?.focus());
        } else if (state.type === 'update') {
          if (!this.adminProgress.open || !this.adminProgress.busy) return;
          if (state.title) this.adminProgress.title = state.title;
          if (state.detail != null) this.adminProgress.detail = state.detail;
          if (state.percent != null) {
            this.adminProgress.percent = Math.max(0, Math.min(100, Math.round(Number(state.percent)||0)));
            this.adminProgress.indeterminate = false;
          }
          if (state.indeterminate != null) this.adminProgress.indeterminate = !!state.indeterminate;
        } else if (state.type === 'success' || state.type === 'error') {
          this.adminProgress.open = true;
          this.adminProgress.busy = false;
          this.adminProgress.outcome = state.type;
          this.adminProgress.title = state.title || (state.type === 'success' ? '操作已完成' : '操作失败');
          this.adminProgress.detail = state.detail || '';
          this.adminProgress.percent = state.type === 'success' ? 100 : this.adminProgress.percent;
          this.adminProgress.indeterminate = false;
          this.$nextTick(() => document.querySelector('.admin-progress-close')?.focus());
        }
      },
      closeAdminProgress() {
        if (this.adminProgress.busy) return;
        this.adminProgress.open = false;
      },
      async loadAboutInfo() {
        this.aboutStatus = 'loading'; this.aboutError = '';
        try {
          const response = await fetch('/api/about', {cache:'no-store'});
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data.info || typeof data.info !== 'object') throw new Error(data.error || '无法加载系统信息');
          for (const key of Object.keys(this.aboutInfo)) this.aboutInfo[key] = String(data.info[key] ?? '');
          this.aboutUpdatedAt = data.updatedAt;
          this.aboutStatus = 'ready';
        } catch(error) { this.aboutError = error.message || '加载失败'; this.aboutStatus = 'error'; }
      },
      async saveAboutInfo() {
        if (page !== 'admin' || !this.isSystem || this.aboutSaving) return;
        this.aboutSaveResult = '';
        const token = localStorage.getItem('aboutWriteToken');
        if (!token) { this.aboutError = '保存需要新的登录凭证。请退出 system 账户后重新登录。'; return; }
        if (!this.aboutInfo.title.trim()) { this.aboutError = '请填写关于页标题'; return; }
        if (this.adminProgress.busy) return;
        this.aboutSaving = true; this.aboutError = '';
        this.reportAdminProgress({type:'start', title:'正在保存系统信息…', detail:'正在向 Gitee 提交设置并等待写入确认', indeterminate:true});
        try {
          const response = await fetch('/api/about', {
            method:'PUT', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token},
            body: JSON.stringify(this.aboutInfo)
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || '保存失败');
          this.aboutUpdatedAt = data.updatedAt;
          this.aboutSaveResult = '已保存到 Gitee，关于页面将显示最新信息';
          this.reportAdminProgress({type:'success', title:'系统信息保存成功', detail:'Gitee 已确认写入，关于页面将显示最新内容'});
          window.flashSuccess?.('关于信息已保存');
        } catch(error) { this.aboutError = error.message || '保存失败，请重试';
          this.reportAdminProgress({type:'error', title:'系统信息保存失败', detail:this.aboutError}); }
        finally { this.aboutSaving = false; }
      },
      refreshPageAction(name, btn) {
        if (!window.CreditRefresh?.run) return this.invokePageAction(name, true);
        return window.CreditRefresh.run(btn, () => this.invokePageAction(name, true));
      },
      async invokePageAction(name, ...args) {
        const btn = args.find(a => a && a.nodeType === 1);
        if (['importStudents','exportSubmissionExcel'].includes(name)) {
          const oldText = btn?.textContent;
          if (btn) { btn.disabled = true; btn.textContent = '正在准备组件…'; }
          try {
            if (name === 'downloadAllZip') { if (!window.JSZip) await injectScript('/vendor/jszip.min.js'); }
            else if (name === 'importStudents' && document.querySelector('#fileInput')?.files?.[0]?.name?.toLowerCase().endsWith('.xls')) {
              if (!window.XLSX?.read) await injectScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
            } else await loadSpreadsheet();
          } catch(err) { window.flashError?.(err.message || '组件加载失败'); return; }
          finally { if (btn) { btn.disabled = false; btn.textContent = oldText; } }
        }
        const action = window[name];
        if (typeof action === 'function') return action(...args);
        window.flashError?.('操作尚未初始化，请稍后重试');
      },
      changeTab(tab) {
        const allowed = ['admins','students','messages','tools','files','maintenance','logs','about'];
        if (!allowed.includes(tab)) return;
        this.activeTab = tab;
        this._tabReady = true;
        if (tab === 'about') this.loadAboutInfo();
        if (page === 'admin') {
          history.replaceState(history.state, '', tab === 'admins' ? '/admin.html' : '/admin.html?tab=' + tab);
          window.__onAdminTabChange?.(tab);
        }
      },
      async checkSystemStatus() {
        this.systemStatus = 'checking';
        try {
          const response = await fetch('/api/admin/check-system', {cache: 'no-store'});
          const data = await response.json().catch(() => null);
          if (!response.ok || !data || typeof data.exists !== 'boolean') {
            throw new Error(data?.error || '无法确认系统初始化状态');
          }
          this.systemStatus = data.exists ? 'initialized' : 'uninitialized';
        } catch (err) {
          console.warn('[system initialization check]', err);
          this.systemStatus = 'error';
        }
      },
      async submitAdminLogin() {
        if (this.loginPending) return;
        this.loginError = '';
        if (!this.username.trim() || !this.password) { this.loginError = '用户名和密码不能为空'; return; }
        this.loginPending = true;
        try {
          const resp = await fetch('/api/auth', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({username: this.username.trim(), password: this.password}) });
          const data = await resp.json();
          if (!resp.ok || !data?.token || !['system','admin'].includes(data?.user?.role)) throw new Error(data?.error || '登录失败');
          localStorage.setItem('adminToken', data.token);
          localStorage.setItem('adminUser', JSON.stringify(data.user));
          if (data.aboutToken) localStorage.setItem('aboutWriteToken', data.aboutToken);
          else localStorage.removeItem('aboutWriteToken');
          window.apiCache?.clear?.();
          window.location.replace(data.user.role === 'system' ? '/admin.html' : '/dashboard.html');
        } catch(err) { this.loginError = err.message || '网络错误，请重试'; window.flashError?.(this.loginError); this.loginPending = false; }
      },
      async submitStudentLogin() {
        if (this.loginPending) return;
        this.loginError = '';
        if (!String(this.studentId).trim() || !this.password) { this.loginError = '请填写学号和密码'; return; }
        this.loginPending = true;
        try {
          const resp = await fetch('/api/students?action=verify', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({studentId: String(this.studentId).trim(),password:this.password}) });
          const data = await resp.json();
          if (!resp.ok || !data?.token || data?.user?.studentId == null) throw new Error(data?.error || '登录失败');
          localStorage.setItem('studentToken', data.token);
          localStorage.setItem('studentUser', JSON.stringify(data.user));
          localStorage.setItem('studentAutoLogin', this.autoLogin ? 'true' : 'false');
          window.apiCache?.clear?.();
          const redirect = new URLSearchParams(window.location.search).get('redirect');
          window.location.replace(window.CreditRouteGuard?.localPath(redirect, '/index.html') || '/index.html');
        } catch(err) { this.loginError = err.message || '网络错误，请重试'; window.flashError?.(this.loginError); this.loginPending = false; }
      },
      async submitSystemSetup() {
        if (this.loginPending) return;
        this.loginError = ''; this.setupSuccess = '';
        if (this.username.trim().length < 4) { this.loginError = '用户名至少4个字符'; return; }
        if (this.password.length < 8) { this.loginError = '密码长度不能少于8位'; return; }
        if (this.password !== this.confirmPassword) { this.loginError = '两次密码输入不一致'; return; }
        this.loginPending = true;
        try {
          const resp = await fetch('/api/admin/init-system', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:this.username.trim(),password:this.password,confirmPassword:this.confirmPassword}) });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data?.error || '创建失败');
          this.setupSuccess = 'System 账户创建成功，正在进入登录页…';
          window.location.replace('/login.html');
        } catch(err) { this.loginError = err.message || '网络错误，请重试'; this.loginPending = false; }
      }
    },
    async mounted() {
      if (page === 'login') {
        await this.checkSystemStatus();
        return;
      }
      if (page === 'student-login' || page === 'create-system' || page === 'close') return;
      if (page === 'about') { await this.loadAboutInfo(); return; }
      if (page === 'upload') window.__setUploadProgress = (state, percent, error) => this.updateUploadProgress(state, percent, error);
      if (page === 'admin') {
        window.__vueAdminUpdate = data => { this.adminRows = Array.isArray(data) ? data.map(v=>({...v})) : []; this.adminListError=''; };
        window.__vueAdminError = message => { this.adminListError = message; };
        window.__adminProgressReport = state => this.reportAdminProgress(state);
        this._busyUnloadHandler = event => {
          if (this.adminProgress.busy) { event.preventDefault(); event.returnValue = ''; }
        };
        this._busyKeyHandler = event => {
          if (!this.adminProgress.busy) return;
          if (event.key === 'Tab' || event.key === 'Escape') {
            event.preventDefault();
            if (event.key === 'Tab') document.querySelector('.admin-progress-dialog')?.focus();
          }
        };
        window.addEventListener('beforeunload', this._busyUnloadHandler);
        window.addEventListener('keydown', this._busyKeyHandler, true);
      }
      try {
        // Vue owns view lifecycle. Existing API workflows are scoped to one page
        // controller, rather than injected as global, persistent legacy scripts.
        const module = await import('/assets/controllers/' + page + '.mjs?v=1.8');
        if (this._isBeingDestroyed || this._isUnmounted) return;
        const cleanup = module.mount();
        this._controllerCleanup = typeof cleanup === 'function' ? cleanup : null;
        if (page === 'admin' && this.activeTab === 'about') this.loadAboutInfo();
        if (page === 'admin' && this.activeTab !== 'admins') window.__onAdminTabChange?.(this.activeTab);
        window.__appReady = true;
        document.dispatchEvent(new Event('viewready'));
      } catch(err) { console.error('[Vue page controller]', err); window.flashError?.('页面初始化失败，请刷新重试'); }
    },
    beforeUnmount() { this._isBeingDestroyed = true; if (page === 'upload') window.__setUploadProgress = null; if (page === 'admin') { window.__adminProgressReport = null; window.removeEventListener('beforeunload', this._busyUnloadHandler); window.removeEventListener('keydown', this._busyKeyHandler, true); } this._controllerCleanup?.(); }
  };
  const app = createApp({
    components: { PageContent },
    setup() {
      const isMobile = ref(media.matches);
      const showMenu = ref(false);
      const online = ref(navigator.onLine);
      const user = ref(adminArea ? safeJSON('adminUser') : safeJSON('studentUser'));
      const hasUser = ref(!!(adminArea ? safeGet('adminToken') : safeGet('studentToken')));
      const sidebarItems = computed(() => {
        if (!adminArea) return navStudent.filter(item => item.href !== '/student-login.html' || !hasUser.value);
        if (user.value.role === 'system') {
          // System student management now lives inside System Management -> Students.
          return navAdmin.filter(item => !['/student.html', '/index.html'].includes(item.href))
            .concat([{ href: '/login.html', title: '退出登录', icon: '⎋', pages: [], action: 'logout-system' }]);
        }
        // Unchanged admin-account routes and actions.
        return navAdmin.filter(item => item.href !== '/admin.html');
      });
      const mobileItems = computed(() => sidebarItems.value.slice(0, 4));
      const brandHref = computed(() => adminArea && user.value.role === 'system' ? '/admin.html' : '/index.html');
      const displayName = computed(() => user.value.name || user.value.username || (adminArea ? '管理账户' : '访客'));
      const refreshAccount = () => {
        // Cross-tab sign-out: the current protected view cannot remain on screen.
        const reroute = window.CreditRouteGuard?.destination(window.location.href);
        if (reroute) { window.CreditRouteGuard.navigateAway(reroute, true); return; }
        user.value = adminArea ? safeJSON('adminUser') : safeJSON('studentUser');
        hasUser.value = !!(adminArea ? safeGet('adminToken') : safeGet('studentToken'));
      };
      const active = item => item.pages.includes(page);
      const onNavClick = (event, item) => {
        if (item.action !== 'logout-system') return;
        event.preventDefault();
        window.CreditRouteGuard.logoutAdmin();
        window.CreditRouteGuard.navigateAway('/login.html', true);
      };
      const updateMobile = () => {
        isMobile.value = media.matches;
        document.documentElement.dataset.device = isMobile.value ? 'mobile' : 'desktop';
      };
      const updateOnline = () => { online.value = navigator.onLine; };
      onMounted(() => {
        updateMobile();
        if (media.addEventListener) media.addEventListener('change', updateMobile);
        else media.addListener(updateMobile);
        window.addEventListener('resize', updateMobile, { passive: true });
        window.addEventListener('online', updateOnline);
        window.addEventListener('offline', updateOnline);
        window.addEventListener('storage', refreshAccount);
        window.addEventListener('credit-auth-changed', refreshAccount);
      });
      onBeforeUnmount(() => {
        if (media.removeEventListener) media.removeEventListener('change', updateMobile);
        else media.removeListener(updateMobile);
        window.removeEventListener('resize', updateMobile);
        window.removeEventListener('online', updateOnline);
        window.removeEventListener('offline', updateOnline);
        window.removeEventListener('storage', refreshAccount);
        window.removeEventListener('credit-auth-changed', refreshAccount);
      });
      return { page, titles, isAuth, adminArea, isMobile, showMenu, online, hasUser,
        sidebarItems, mobileItems, brandHref, displayName, active, onNavClick, title: titles[page] || '学分服务', user };
    },
    template: `
      <div class="app-frame" :class="{'is-auth': isAuth, 'is-mobile': isMobile, 'is-admin': adminArea}">
        <aside v-if="!isAuth" class="app-sidebar" :class="{'opened':showMenu}" aria-label="功能导航">
          <a class="brand" :href="brandHref" aria-label="学分申请系统首页">
            <span class="brand-mark">学</span><span class="brand-copy"><b>学分服务中心</b><small>CREDIT SERVICE PORTAL</small></span>
          </a>
          <div class="sidebar-section-label">工作空间</div>
          <nav class="side-nav">
            <a v-for="item in sidebarItems" :key="item.href" :href="item.href"
              class="side-link" @click="onNavClick($event,item)" :class="{selected:active(item)}" :aria-current="active(item)?'page':null">
              <span class="side-icon">{{item.icon}}</span><span>{{item.title}}</span><span v-if="active(item)" class="side-current"></span>
              <span v-if="item.href==='/messages.html'" class="msg-badge hidden" data-message-badge aria-label="未读消息">0</span>
            </a>
          </nav>
          <div class="sidebar-footer">
            <div class="sidebar-footnote"><span class="online-dot" :class="{offline:!online}"></span>{{online?'服务连接正常':'当前处于离线状态'}}</div>
            <div class="sidebar-account"><span class="account-avatar">{{displayName.slice(0,1)}}</span><span><b>{{displayName}}</b><small>{{hasUser?(adminArea?'管理员账户':'已登录学生'):'欢迎使用'}}</small></span></div>
          </div>
        </aside>
        <div v-if="showMenu" class="nav-shade" @click="showMenu=false" aria-hidden="true"></div>
        <div class="app-main">
          <header class="app-topbar">
            <div class="topbar-left">
              <button v-if="!isAuth" v-show="isMobile" class="menu-trigger" @click="showMenu=!showMenu" :aria-expanded="showMenu" aria-label="打开功能菜单">☰</button>
              <a v-if="isAuth" class="topbar-home" href="/index.html"><span class="topbar-emblem">学</span>学分服务中心</a>
              <div v-else class="breadcrumb"><span>服务中心</span><span class="breadcrumb-sep">/</span><b>{{title}}</b></div>
            </div>
            <div class="topbar-right"><span class="status-indicator"><span class="online-dot" :class="{offline:!online}"></span>{{online?'在线服务':'网络已断开'}}</span><span class="topbar-identity" v-if="!isAuth">{{displayName}}</span></div>
          </header>
          <div class="app-stage" :class="{'auth-stage':isAuth}">
            <section v-if="isAuth" class="auth-intro">
              <div class="intro-chip"><span class="intro-chip-dot"></span> 学分管理 · 数字校园</div>
              <h1>每一份努力，<br><em>都值得被记录。</em></h1>
              <p>从学分申请到审核反馈，从材料上传到进度查询，一站式连接学生与管理人员。</p>
              <div class="intro-features"><span>✓ 流程清晰</span><span>✓ 实时反馈</span><span>✓ 安全管理</span></div>
              <div class="intro-deco"><span class="deco-sheet d1"></span><span class="deco-sheet d2"></span><span class="deco-check">✓</span></div>
            </section>
            <main class="page-view" id="pageView"><page-content /></main>
          </div>
          <footer class="desktop-footer">学分服务中心 <span>·</span> 服务于每一次成长</footer>
        </div>
        <nav v-if="!isAuth" class="mobile-dock" aria-label="移动端快捷导航">
          <a v-for="item in mobileItems" :href="item.href" @click="onNavClick($event,item)" :key="item.href" :class="{'active':active(item)}" :aria-current="active(item)?'page':null"><span class="dock-icon">{{item.icon}}</span><small>{{item.title}}</small><span v-if="item.href==='/messages.html'" class="msg-badge hidden" data-message-badge aria-label="未读消息">0</span></a>
        </nav>
      </div>`
  });
  app.config.warnHandler = (msg) => { console.warn('[Vue view]', msg); };
  // Async upload/setup checks are complete BEFORE mounting the destination view.
  // Until then the existing first-paint skeleton remains visible, never the wrong form.
  const preflight = window.__routePreflightPromise;
  if (preflight) {
    Promise.resolve(preflight).then(where => {
      if (where) { window.CreditRouteGuard.navigateAway(where, true); return; }
      if (!window.__routeRedirecting) app.mount('#app');
    }).catch(err => {
      console.error('[page preflight]', err);
      const host = document.getElementById('app');
      host.innerHTML = '<main class="preflight-error" role="alert"><div class="preflight-error-icon">!</div><h2>服务状态检查失败</h2><p>暂时无法确认当前服务是否开放，请检查网络连接后重试。</p><button type="button" id="retryServiceCheck">重新检查</button><a href="/index.html">返回学分总览</a></main>';
      document.getElementById('retryServiceCheck').addEventListener('click', () => window.location.reload());
    });
  } else {
    app.mount('#app');
  }
})();
