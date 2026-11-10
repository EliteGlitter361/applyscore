/** 学分申请系统 · Vue 3 page controllers and rendering (2026). */
(() => {
  'use strict';
  if (window.__routeRedirecting || window.__musicEntering) return; // preflight already redirected, never mount a protected view
  const page = document.documentElement.dataset.page || 'index';
  const adminPermissionQueue = new Map();
  let adminPermissionsSaving = false;
  const titles = {
    home: '主页', index: '学分总览', upload: '提交申请', detail: '申请详情', 'assigned-request':'管理员发放的申请', 'file-upload': '文件上传',
    messages: '我的消息', 'student-login': '学生登录', login: '管理员登录',
    'create-system': '系统初始化', close: '系统通知', 'admin-tools':'管理工具',dashboard: '审核工作台',
    admin: '系统管理', student: '学生管理', about: '关于', music:'网页音乐盒', settings:'设置'
  };
  const authPages = new Set(['student-login', 'login', 'create-system', 'close']);
  const adminPages = new Set(['dashboard','admin-tools', 'student', 'admin', 'music']);
  const isAuth = authPages.has(page);
  const adminArea = adminPages.has(page) || (['home','about','settings'].includes(page) && new URLSearchParams(location.search).get('view') === 'admin' && !!localStorage.getItem('adminToken'));
  const studentHome = {href:'/home.html',title:'主页',icon:'⌂',pages:['home']};
  const adminHome = {...studentHome,href:'/home.html?view=admin'};
  const workDescriptions = {
    '/index.html':'查看学分记录和申请进度',
    '/upload.html':'填写申请并上传证明材料',
    '/file-upload.html':'查看文件任务并提交附件',
    '/messages.html':'查看通知和审核反馈',
    '/dashboard.html':'查看待审核和已审核的申请',
    '/admin-tools.html':'处理消息、文件和学生封禁',
    '/student.html':'查看学生名单和账户状态',
    '/admin.html':'管理账户、学生和系统设置',
    '/admin.html?tab=students':'查询学生并管理账户状态',
    '/admin.html?tab=maintenance':'查看账户在线状态和系统安全信息'
  };
  const navStudent = [
    studentHome,
    { href: '/index.html', title: '学分总览', icon: '◫', pages: ['index','detail'] },
    { href: '/upload.html', title: '提交申请', icon: '＋', pages: ['upload'] },
    { href: '/file-upload.html', title: '文件上传', icon: '⇧', pages: ['file-upload'] },
    { href: '/messages.html', title: '我的消息', icon: '✉', pages: ['messages'] },
    { href: '/student-login.html', title: '学生登录', icon: '♙', pages: ['student-login'] },
    { href: '/login.html', title: '管理后台', icon: '▦', pages: ['login'] },
    { href: '/about.html', title: '关于', icon: 'ⓘ', pages: ['about'] },
    { href:'/settings.html',title:'设置',icon:'⚙',pages:['settings'] }
  ];
  const navAdmin = [
    adminHome,
    { href: '/dashboard.html', title: '审核工作台', icon: '☷', pages: ['dashboard'] },
    {href:'/admin-tools.html',title:'管理工具',icon:'＋',pages:['admin-tools']},
    { href: '/student.html', title: '学生管理', icon: '♧', pages: ['student'] },
    { href: '/admin.html', title: '系统管理', icon: '⚙', pages: ['admin'] },
    { href: '/login.html', title: '退出登录', icon: '⎋', pages: [], action:'logout-system' },
    { href: '/about.html?view=admin', title: '关于', icon: 'ⓘ', pages: ['about'] },
    { href:'/settings.html?view=admin',title:'设置',icon:'⚙',pages:['settings'] },
    { href:'/music.html',title:'网页音乐盒',icon:'▣',pages:['music'] }
  ];
  // Assets are mapped by the user's supplied filenames; no guesswork about image roles.
  const iconFor = item => item.pages.includes('home') ? 'soul-fire.gif' : item.action==='logout-system' ? '退出登录.webp' : ({
    '/index.html':'学分总览.png', '/upload.html':'提交申请.webp',
    '/file-upload.html':'文件上传.webp', '/messages.html':'我的消息.png',
    '/student-login.html':'学生登录.webp', '/login.html':'后台管理.gif',
    '/dashboard.html':'审核台.webp', '/student.html':'学生登录.webp',
    '/admin-tools.html':'command-block.gif','/admin.html':'系统管理.gif','/admin.html?tab=students':'学生登录.webp','/admin.html?tab=maintenance':'系统管理.gif', '/about.html':'关于.png',
    '/about.html?view=admin':'关于.png', '/music.html':'音乐盒.webp', '/settings.html':'罗盘设置图标.png', '/settings.html?view=admin':'罗盘设置图标.png',
    '#music-settings':'音乐盒设置.webp'
  }[item.href] || null);
  const accountImage = role => '/assets/icons/' + (role==='system'?'system账户头像.png':role==='admin'?'admin账户头像.webp':role==='student'?'登录后用户头像.png':'访客头像.webp');
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
  // Spreadsheet import/export keeps the existing vendor support; native ZIP downloads do not use JSZip.
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
        tool:{permissions:{},panel:'',loading:true,busy:false,error:'',notice:'',messageTitle:'',messageContent:'',refreshing:false,banRows:[],files:[],search:''},toolApi:{},dashboardActiveTab:'pending',dashboardCanBan:false,dashboardCanAssign:false,dashboardCanAudit:false,dashboardPermissionError:'',
        dashboardApps:[],dashboardLoading:true,dashboardRefreshing:false,dashboardError:'',dashboardSearch:'',
        dashboardSelected:{},dashboardStudents:[],dashboardStudentsLoading:false,dashboardStudentsError:'',
        dashboardBusy:false,dashboardActionError:'',dashboardModalApp:null,dashboardModalReadOnly:false,
        dashboardImageErrors:{},dashboardPreviewSrc:'',dashboardDeleteConfirm:false,dashboardBanConfirm:null,
        dashboardReasonMode:'',dashboardReasonText:'',dashboardReasonError:'',dashboardRejectConfirm:false,
        indexTab:new URLSearchParams(location.search).get('tab')==='assigned'?'assigned':'pending', indexSelectedTaskId:null, indexSearch:'', indexSearchReady:'', indexApps:[], indexLoading:true,
        indexError:'', indexRefreshing:false,indexLoggedIn:false,indexUser:null,indexMenuOpen:false,indexToasts:[],
        indexAnnouncementOpen:false,indexAnnouncementTheme:"none",indexAnnouncementAero:false,indexAnnouncementTitle:'系统公告',indexAnnouncementMessage:'',indexAnnouncementShowConfirm:true,
        assignedPageTask:null,assignedPageLoading:true,assignedPageError:'',assignedPageForm:{activityName:'',participants:'',location:'',activityTime:'',images:[],attachment:null,busy:false,error:''},assignedPageApi:{},
        detailAssignedAttachment:null,detailApp:null, detailLoading:true, detailError:'', detailCanEdit:false, detailForm:{versionName:'',publisher:'',participants:''}, detailEditing:false, detailCancelling:false, detailPreviews:[], detailPreviewSrc:'', detailImageFailed:{}, detailApi:{},
        fileRows:[],fileLoading:false,fileError:'',fileActionBusy:false,fileSelected:{},
        messageSelectionMode:false,messageSelected:{},messagesRows:[],messagesLoading:true,messagesError:'',messagesBusy:false,messageDetail:null,
        studentCanBan:false,studentBanApi:{},studentsRows:[],studentsLoading:true,studentsError:'',studentsBusy:false,selectedStudentIds:{},studentNewName:'',studentNewId:'',studentImportVisible:false,studentImportProgress:0,studentImportResult:'',fileUploadSelections:[],
        fileTaskRequirementEnabled:false,fileTaskRequirementMessage:'',fileTaskAudience:'all',fileTaskStudents:[],fileTaskRecipients:{},fileTaskStudentSearch:'',fileTaskStudentsLoading:false,fileTaskStudentsError:'',fileTaskDetailOpen:false,fileTaskCreateOpen:false,fileEntranceSaving:false,fileEntranceEnabled:true,fileTaskLoaded:false,fileTaskRefreshing:false,fileTaskSelected:{},fileTasksLoading:true,fileTasks:[],fileTaskId:'',fileTaskTitle:'',fileTaskDescription:'',fileTaskError:'',fileManageTask:null,entryCountdown:'',
        scheduleForms:Object.fromEntries(['enabled','fileUploadEnabled','announcementEnabled'].map(target=>[target,{open:{mode:'none',at:'',hours:0,minutes:0},close:{mode:'none',at:'',hours:0,minutes:0}}])),scheduleReady:false,scheduleError:'',
        settingsTheme: window.CreditTheme?.read() || 'light',
        settingsMusic:{enabled:true,showIsland:true,autoPlay:false,mode:'sequence'},
        settingsCacheCount:null,settingsNotice:'',settingsBusy:false,
        settingsReducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false,
        isSystem: adminArea && safeJSON('adminUser').role === 'system',
        closeShowReturn: new URLSearchParams(window.location.search).get('hideReturn') !== '1',
        closeMessage: new URLSearchParams(window.location.search).get('msg'),
        initialStudentsTab: page === 'admin' && new URLSearchParams(window.location.search).get('tab') === 'students',
        activeTab: page === 'admin' && ['admins','students','messages','tools','files','requests','request-activities','maintenance','logs','about'].includes(new URLSearchParams(window.location.search).get('tab')) ? new URLSearchParams(window.location.search).get('tab') : 'admins',
        username: '', studentId: '', password: '', confirmPassword: '', autoLogin: true,
        loginError: '', loginPending: false, systemStatus: 'checking', systemStatusError: '', setupSuccess: '',
        adminRows: null, adminListError: '',
        adminStudentsRows:[],adminStudentsLoading:true,adminStudentsError:'',adminStudentSelected:{},
        messageHistoryRows:[],messageHistoryFilter:'',messageHistoryLoading:false,messageHistoryError:'',
        adminMessageStudents:[],adminMessageStudentsLoading:false,adminMessageStudentsError:'',adminMessageSelected:{},adminMessageResult:'',
        adminPermissionDefinitions:[{key:'auditPermission',label:'审核申请'},{key:'canBan',label:'封禁学生'},{key:'assignedPermission',label:'指定申请'},{key:'messagePermission',label:'发送消息'},{key:'filePermission',label:'查看文件'}],adminLogs:[],adminLogsLoading:false,adminLogsError:'',adminMaintenanceScan:null,requestTitle:'',requestDescription:'',requestStudentSelected:{},requestAttachmentRequired:false,requestExpiryMode:'none',requestExpiresAt:'',requestDurationDays:7,requestBusy:false,requestNotice:'',requestActivitySelected:{},requestListBusy:false,requestListError:'',requestDetailId:null,requestReviewBusy:false,assignedRequests:[],accountRiskRules:null,accountRiskSaving:false,accountSecurityNow:Date.now(),
        accountLoginPolicy:{student:'single',admin:'single'},accountPolicyBusy:false,accountRiskDetail:null,accountSecurityRows:[],accountSecurityBusy:false,accountSecurityLoading:false,accountSecurityError:'',indexPublishedTasks:[],requestStudentSearch:'',dashboardAssigned:[],indexAssignedTasks:[],taskForms:{},
        adminImportFile:null,adminImportBusy:false,adminImportVisible:false,adminImportPercent:0,adminImportDone:0,adminImportTotal:0,adminImportResult:'',adminImportFailures:[],
        adminUploadEnabled:true,adminUploadMultiple:true,adminUploadMaxSubmissions:1,adminUploadFileSizeMode:'20',adminUploadCustomSize:20,
        adminUploadDeadlineMode:'none',adminUploadHours:0,adminUploadMinutes:0,adminUploadSeconds:0,adminUploadDate:'',
        adminUploadSaving:false,adminUploadSaveResult:'',adminUploadSaveError:false,
        fileUploadAllowedMultiple:true,fileUploadMaxMB:20,fileUploadHint:'正在读取上传规则…',fileUploadCountdown:'',fileUploadCountdownUrgent:false,fileUploadExpired:false,
        fileUploadPersonName:'',fileUploadPersonId:'',fileUploadBusy:false,fileUploadModalOpen:false,fileUploadModalProgress:0,fileUploadModalWaiting:false,fileUploadModalFiles:[],
        adminSystemClosesAt:"",adminSystemShutdownMode:"none",adminSystemShutdownHours:0,adminSystemShutdownMinutes:0,adminSystemShutdownSavedAt:null,adminSystemShutdownResult:"",adminEntryEnabled:true,adminEntryMessage:'',adminEntryClosedShowReturn:true,adminEntryResult:'',
        adminRequirementEnabled:false,adminRequirementMessage:'',adminRequirementResult:'',
        adminAnnouncementEnabled:false,adminAnnouncementTheme:"none",adminAnnouncementAero:false,adminAnnouncementTitle:'系统公告',adminAnnouncementMessage:'',adminAnnouncementShowConfirm:true,adminAnnouncementResult:'',
        adminSubmissionOpen:false,adminSubmissionReady:false,adminSubmissionTab:'submitted',
        adminSubmissionRows:{submitted:[],notSubmitted:[]},adminExcelExportBusy:false,adminExcelExportResult:'',adminSubmissionStatus:'正在获取提交状态…',adminSubmissionUpdatedAt:0,
        aboutInfo: {title:'',subtitle:'',description:'',organization:'',version:'',contactEmail:'',website:''},
        aboutUpdatedAt: null, aboutStatus: 'loading', aboutError: '', aboutSaving: false, aboutSaveResult: '',
        musicTracks:[],musicSelected:{},musicLoading:false,musicBusy:false,musicError:'',musicPercent:0,musicActionLabel:'', musicDeleteAsk:false, musicDeletePending:[],
        adminProgress: {open:false, busy:false, outcome:'', title:'', detail:'', percent:0, indeterminate:true, scope:''},
        uploadModalOpen: false, uploadModalProgress: 0, uploadModalState: 'uploading', uploadModalError: '',
        applicationEntryBlocked:true,applicationEntryMessage:'',applicationName:'',applicationStudentId:'',applicationActivity:'',applicationRoster:[],applicationRosterQuery:'',applicationParticipantIds:[],applicationRosterLoading:true,applicationRosterError:'',applicationLocation:'',applicationTime:'',
        applicationImages:[],applicationProcessingImages:false,applicationSubmitting:false,applicationPreviewSrc:''
      };
    },
    computed:{
      messageHistorySenders(){
        return [...new Set(this.messageHistoryRows.map(row=>row.sentBy))].sort((a,b)=>(a || '').localeCompare(b || ''));
      },
      messageHistoryFiltered(){
        return this.messageHistoryFilter !== ''
          ? this.messageHistoryRows.filter(row=>row.sentBy===this.messageHistoryFilter)
          : this.messageHistoryRows;
      },
      currentAdminAccess(){ return this.adminRows?.find(row=>row.isCurrent); },
      adminTabPermissions(){
        const access = this.currentAdminAccess;
        return {messages:access?.messagePermission,files:access?.filePermission,requests:access?.assignedPermission,'request-activities':access?.assignedPermission};
      },

      fileManageRows(){return this.fileRows.filter(r=>(r.taskId||'legacy')===this.fileManageTask);},

      dashboardPending(){return this.dashboardApps.filter(a=>a.status==='pending');},
      dashboardApproved(){return this.dashboardApps.filter(a=>a.status==='approved');},
      dashboardPendingFiltered(){return this.dashboardFilter(this.dashboardPending);},
      dashboardApprovedFiltered(){return this.dashboardFilter(this.dashboardApproved);},
      dashboardStudentsFiltered(){const term=this.dashboardSearch.toLowerCase();return this.dashboardStudents.filter(s=>!term||[s.name,s.studentId].some(v=>String(v||'').toLowerCase().includes(term)));},
      dashboardSelectedCount(){return this.dashboardApproved.filter(a=>this.dashboardSelected[String(a.id)]).length;},
      dashboardAllApprovedSelected(){return this.dashboardApprovedFiltered.length>0&&this.dashboardApprovedFiltered.every(a=>!!this.dashboardSelected[String(a.id)]);},
      detailBusy(){return this.detailEditing || this.detailCancelling;},
      adminUploadFileSizePreview(){const mb=this.adminUploadFileSizeMode==='custom'?Number(this.adminUploadCustomSize):Number(this.adminUploadFileSizeMode);return Number.isFinite(mb)&&mb>0?`当前限制：单个文件不超过 ${mb}MB`:'请输入有效的文件大小';},
      adminUploadDeadlinePreview(){if(this.adminUploadDeadlineMode==='none')return '不限制';if(this.adminUploadDeadlineMode==='date'){const d=new Date(this.adminUploadDate);return this.adminUploadDate&&!Number.isNaN(d.getTime())?`截止时间：${d.toLocaleString('zh-CN')}`:'请选择有效日期时间';}const sec=Number(this.adminUploadHours)*3600+Number(this.adminUploadMinutes)*60+Number(this.adminUploadSeconds);return Number.isFinite(sec)&&sec>0?`保存后截止：${new Date(Date.now()+sec*1000).toLocaleString('zh-CN')}`:'请输入有效时长';},
      adminStudentsEmpty(){return !this.adminStudentsLoading && !this.adminStudentsError && this.adminStudentsRows.length===0},
      adminLogsEmpty(){return !this.adminLogsLoading && !this.adminLogsError && this.adminLogs.length===0},
      adminStudentsSelectedCount(){return this.adminStudentsRows.filter(s=>this.adminStudentSelected[String(s.studentId)]).length},
      adminStudentsAllSelected(){return this.adminStudentsRows.length>0 && this.adminStudentsSelectedCount===this.adminStudentsRows.length},
      adminMessageSelectedCount(){return this.adminMessageStudents.filter(s=>this.adminMessageSelected[String(s.studentId)]).length},
      adminSubmissionVisible(){return this.adminSubmissionRows[this.adminSubmissionTab]||[]},
      requestSelectedCount(){return Object.values(this.requestStudentSelected).filter(Boolean).length},fileSelectedCount(){return new Set(this.fileRows.filter(r=>this.fileSelected[String(r.id)]).map(r=>String(r.id))).size},selectedMusicCount(){return this.musicTracks.filter(t=>this.musicSelected[t.id]).length},
      selectedStudentsCount(){return this.studentsRows.filter(s=>this.selectedStudentIds[String(s.studentId)]).length},
      studentsAllSelected(){return !!this.studentsRows.length && this.selectedStudentsCount===this.studentsRows.length},
      applicationVisibleRoster(){
        const query=this.applicationRosterQuery.toLowerCase();
        return this.applicationRoster.filter(student=>!query||[student.name,student.studentId].some(value=>String(value).toLowerCase().includes(query)));
      },
      indexTasksVisible(){return !this.indexAnnouncementOpen && this.indexTab==='assigned' && this.indexAssignedTasks.length>0;},
      indexSelectedTask(){return this.indexAssignedTasks.find(t=>t.id===this.indexSelectedTaskId)||null;},
      visibleAssignedTasks(){
        const term=String(this.indexSearchReady||'').trim().toLowerCase();
        return (this.indexAssignedTasks||[]).filter(t=>!t.submitted||(t.submission?.status||'pending')==='pending').filter(t=>!term||[t.title,t.description,t.id,t.submitted?'已提交':t.expired?'已过期':'待完成'].some(v=>String(v||'').toLowerCase().includes(term)));
      },
      assignedStatusTasks(){const status=this.indexTab==='needs-fix'?'needs_fix':this.indexTab==='pending'?'approved':null;const term=this.indexSearchReady;return status?(status==='approved'?this.indexPublishedTasks:this.indexAssignedTasks).filter(t=>t.submission&&(t.submission.status||'pending')===status&&(!term||[t.title,t.submission.activityName,t.submission.name,t.submission.studentId,t.submission.rejectReason].some(v=>String(v||'').toLowerCase().includes(term)))):[];},
      toolBanFiltered(){const q=this.tool.search.toLowerCase();return this.tool.banRows.filter(s=>!q||[s.name,s.studentId].some(v=>String(v||'').toLowerCase().includes(q)));},
      toolFilesFiltered(){const q=this.tool.search.toLowerCase();return this.tool.files.filter(r=>!q||[r.name,r.studentId,...r.files].some(v=>String(v||'').toLowerCase().includes(q)));},
      requestStudentsFiltered(){const q=this.requestStudentSearch.toLowerCase();return this.adminStudentsRows.filter(s=>!q||[s.name,s.studentId].some(v=>String(v||'').toLowerCase().includes(q)));},
      dashboardAssignedFiltered(){return this.dashboardFilter(this.dashboardAssigned.filter(a=>a.status==='pending'));},
      requestDetail(){return this.assignedRequests.find(t=>t.id===this.requestDetailId)||null;},
      visibleIndexApps(){
        if(page!=='index')return [];
        const account=this.indexUser;
        const term=this.indexSearchReady;
        const assigned=this.assignedStatusTasks.map(t=>{const sub=t.submission;return {...sub,id:'assigned:'+t.id+':'+sub.studentId,assigned:true,taskId:t.id,versionName:sub.activityName||t.title,packageName:sub.studentId,publisher:String(sub.activityTime||'').replace('T',' '),createdAt:sub.submittedAt||0};});
        return [...this.indexApps,...assigned].sort((a,b)=>(Number(b.createdAt)||0)-(Number(a.createdAt)||0)).filter(a=>{
          if(this.indexTab==='pending' && a.status!=='approved')return false;
          if(this.indexTab==='needs-fix' && (a.status!=='needs_fix' || !account || String(a.packageName)!==String(account.studentId)))return false;
          return !term || [a.name,a.packageName,a.versionName].some(value=>String(value||'').toLowerCase().includes(term));
        });
      }
    },
    methods: {
      openMessageHistory(){
        this.messageHistoryFilter='';
        this.$refs.messageHistoryDialog.showModal();
        void this.loadMessageHistory();
      },
      async loadMessageHistory(){
        if(this.messageHistoryLoading)return;
        this.messageHistoryLoading=true;
        this.messageHistoryError='';
        try{
          const response=await fetch('/api/messages?scope=admin-history',{
            headers:{Authorization:'Bearer '+safeGet('adminToken')},cache:'no-store'
          });
          const rows=await response.json();
          if(!response.ok)throw new Error(rows.error);
          this.messageHistoryRows=rows;
        }catch(error){
          this.messageHistoryError=error.message==='无权查看消息历史'
            ? error.message : '暂时无法读取消息历史，请重试';
        }finally{
          this.messageHistoryLoading=false;
        }
      },
      formatMessageHistoryTime(value){
        return value ? new Date(value).toLocaleString('zh-CN',{hour12:false}) : '时间未知';
      },
      async editWelcomeName(kind, account) {
        if (!this.currentAdminAccess?.isInitialSystem) return;
        const id = String(kind === 'admin' ? account.username : account.studentId);
        const name = await new Promise(resolve => window.showPrompt(
          '主页欢迎称呼', '为 '+id+' 设置主页称呼，留空恢复默认。', account.welcomeName || '',
          '最多 40 字', '保存', '取消', resolve
        ));
        if (name === null) return;
        try {
          const response = await fetch('/api/welcome-name', {
            method:'PUT', headers:{'Content-Type':'application/json',Authorization:'Bearer '+safeGet('adminToken')},
            body:JSON.stringify({kind,id,name})
          });
          const result = await response.json();
          if (!response.ok) throw Error(result.error);
          account.welcomeName = result.name;
          window.syncBus?.emit('welcome-name', {kind,id});
          window.flashSuccess?.(result.message);
        } catch (error) { window.flashError?.(error.message); }
      },
      toggleAdminAccountPermission(account, key) {
        if (account.canEditPermissions) this.queueAdminPermission(account, key);
      },
      toggleToolPermission(account, key) {
        if (account.canDelegate) this.queueAdminPermission(account, key);
      },
      queueAdminPermission(account, key) {
        const previous = !!account[key];
        account[key] = !previous;
        if (!adminPermissionQueue.has(account.username)) adminPermissionQueue.set(account.username, new Map());
        const changes = adminPermissionQueue.get(account.username);
        const pending = changes.get(key);
        changes.set(key, { previous: pending?.previous ?? previous, value: account[key] });
        if (!adminPermissionsSaving) void this.saveAdminPermissions();
      },
      async saveAdminPermissions() {
        adminPermissionsSaving = true;
        let saved = false;
        while (adminPermissionQueue.size) {
          const [username, changes] = adminPermissionQueue.entries().next().value;
          adminPermissionQueue.delete(username);
          const payload = Object.fromEntries([...changes].map(([key, change]) => [key, change.value]));
          try {
            const response = await fetch('/api/admin', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('adminToken') },
              body: JSON.stringify({ username, ...payload })
            });
            if (!response.ok) {
              const result = await response.json().catch(() => ({}));
              throw new Error(result.error || '权限保存失败');
            }
            saved = true;
          } catch (error) {
            const account = this.adminRows?.find(row => row.username === username);
            for (const [key, change] of changes) {
              const pending = adminPermissionQueue.get(username)?.get(key);
              if (pending) pending.previous = change.previous;
              else if (account) account[key] = change.previous;
            }
            window.flashError?.(error.message);
          }
        }
        adminPermissionsSaving = false;
        window.apiCache?.invalidate('/api/admin');
        window.syncBus?.emit('admins', {});
        if (!window.syncBus) void window.loadAdmins?.(true);
        if (saved) window.flashSuccess?.('权限已更新');
      },
      async deleteAssignedActivities(){const ids=Object.keys(this.requestActivitySelected).filter(id=>this.requestActivitySelected[id]);if(!ids.length||this.requestListBusy)return;window.showConfirm('删除指定申请活动','将删除选中的 '+ids.length+' 个活动及其提交记录，是否继续？','删除','取消',async ok=>{if(!ok)return;this.requestListBusy=true;try{const r=await window.operationFetch('删除指定申请活动','/api/requests',{method:'DELETE',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('adminToken')},body:JSON.stringify({ids})});const d=await r.json();if(!r.ok)throw Error(d.error);this.requestActivitySelected={};this.requestDetailId=null;window.apiCache?.invalidatePrefix('/api/requests');window.syncBus?.emit('requests',{});await this.loadAssignedRequests();window.flashSuccess?.('活动已删除');}catch(e){window.flashError?.(e.message)}finally{this.requestListBusy=false;}});},
      async apiCacheRefreshRequests(){if(this.requestListBusy)return;this.requestListBusy=true;try{window.apiCache?.invalidate('/api/requests');await this.loadAssignedRequests();}finally{this.requestListBusy=false;}},
      async dashboardPreviewAssigned(file){try{const app=this.dashboardModalApp,q=new URLSearchParams({action:'download',taskId:app.taskId,studentId:app.studentId,file:file.name});const r=await fetch('/api/requests?'+q,{headers:{Authorization:'Bearer '+localStorage.getItem('adminToken')}});if(!r.ok)throw Error('证明图片读取失败');if(this._assignedPreviewUrl)URL.revokeObjectURL(this._assignedPreviewUrl);const ext=(file.originalName||file.name).split('.').pop().toLowerCase(),mime={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',svg:'image/svg+xml',avif:'image/avif'}[ext]||'image/png';this._assignedPreviewUrl=URL.createObjectURL(new Blob([await r.blob()],{type:mime}));this.dashboardPreviewSrc=this._assignedPreviewUrl;}catch(e){window.flashError?.(e.message)}},
      async downloadAssigned(t,sub,file){try{const q=new URLSearchParams({action:'download',taskId:t.id,studentId:sub.studentId,file:file.name});const token=localStorage.getItem('adminToken');const r=await fetch('/api/requests?'+q,{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error((await r.json()).error||'下载失败');const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=file.originalName||file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){window.flashError?.(e.message)}},
      indexToggleTab(tab){
        if(!['pending','needs-fix','assigned'].includes(tab))return;
        this.indexTab=tab;
        this.indexSelectedTaskId=null;
        if(tab==='assigned'&&this.indexLoggedIn)void this.loadAssignedStudentTasks();
      },
      async loadAccountSecurity(silent=false){
        if(this._accountSecurityReading)return;
        this._accountSecurityReading=true;
        this.accountSecurityLoading=!silent;
        const revision=this._accountPolicyRevision;
        try{
          const r=await fetch('/api/account-security',{headers:{Authorization:'Bearer '+localStorage.getItem('adminToken')},cache:'no-store'});
          const data=await r.json();
          if(!r.ok||!Array.isArray(data.rows))throw Error(data.error||'读取账户状态失败');
          if(revision===this._accountPolicyRevision)this.accountLoginPolicy=data.policy;
          if(!this.accountRiskRules)this.accountRiskRules=data.riskRules;
          this.accountSecurityRows=data.rows;this.accountSecurityError='';
        }catch(e){if(!silent||!this.accountSecurityRows.length)this.accountSecurityError=e.message;}
        finally{this._accountSecurityReading=false;this.accountSecurityLoading=false;}
      },
      async saveAccountRiskRules(){
        if(this.accountRiskSaving||!this.accountRiskRules)return;
        this.accountRiskSaving=true;
        try{
          const r=await window.withOverlay('正在保存账户风控…',()=>fetch('/api/account-security',{
            method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('adminToken')},
            body:JSON.stringify({operation:'risk-policy',rules:this.accountRiskRules})
          }));
          const data=await r.json();
          if(!r.ok)throw Error(data.error||'保存失败');
          window.flashSuccess?.('账户风控已保存');
        }catch(e){window.flashError?.(e.message||'保存失败');}
        finally{this.accountRiskSaving=false;}
      },
      studentIsBanned(row) {
        return row.banned && (!row.banUntil || row.banUntil > this.accountSecurityNow);
      },
      accountBanCountdown(row){
        if(!row.banned)return '—';
        if(!row.banUntil)return '长期封禁';
        const left=Math.max(0,Math.ceil((row.banUntil-this.accountSecurityNow)/1000));
        return Math.floor(left/86400)+'天'+Math.floor(left%86400/3600)+'小时'+Math.floor(left%3600/60)+'分钟'+left%60+'秒';
      },
      async saveAccountLoginPolicy(kind,mode){
        if(this.accountPolicyBusy||this.accountLoginPolicy[kind]===mode)return;
        this.accountPolicyBusy=true;
        try{
          const r=await fetch('/api/account-security',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('adminToken')},body:JSON.stringify({kind,mode,operation:'policy'})});
          if(!r.ok){const data=await r.json();throw Error(data.error||'保存失败');}
          this._accountPolicyRevision=(this._accountPolicyRevision||0)+1;
          this.accountLoginPolicy={...this.accountLoginPolicy,[kind]:mode};
          await this.loadAccountSecurity(true);
        }catch(e){window.flashError?.(e.message||'保存失败');}
        finally{this.accountPolicyBusy=false;}
      },
      async loginDeviceHeaders(){
        let id=localStorage.getItem('credit-device-id');
        if(!id&&window.crypto?.randomUUID){id=window.crypto.randomUUID();localStorage.setItem('credit-device-id',id);}
        let model='';
        try{
          const values=await Promise.race([navigator.userAgentData?.getHighEntropyValues(['model']),new Promise(resolve=>setTimeout(resolve,500))]);
          model=values?.model||'';
        }catch{}
        return {'Content-Type':'application/json',...(id?{'X-Credit-Device-Id':id}:{}),...(model?{'X-Credit-Device-Name':encodeURIComponent(model.slice(0,120))}:{})};
      },
      async changeAccountSecurity(row,operation){
        if(this.accountSecurityBusy)return;
        const label={kick:'强制下线',ban:'账户封禁',unban:'解除封禁'}[operation];
        this.accountSecurityBusy=true;
        try{
          const payload={kind:row.kind,id:row.id,operation};
          if(operation==='ban'){
            const ban=await window.CreditPromptBan(row.name);
            if(!ban)return;
            Object.assign(payload,{reason:ban.banReason,banUntil:ban.banUntil});
          }else if(!await new Promise(resolve=>window.showConfirm(label,'确认对 '+row.name+' 执行'+label+'？','确认','取消',resolve)))return;
          const r=await window.withOverlay('正在'+label+'…',()=>fetch('/api/account-security',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('adminToken')},body:JSON.stringify(payload)}));
          const result = await r.json();
          if(!r.ok)throw Error(result.error||'账户操作失败');
          window.flashSuccess?.(result.message);
          if (row.kind === 'student' && operation !== 'kick') {
            window.apiCache?.invalidate('/api/students');
            window.syncBus?.emit('students', {});
          }
          await this.loadAccountSecurity();
        }catch(e){window.flashError?.(e.message||'账户操作失败');}
        finally{this.accountSecurityBusy=false;}
      },
      fileSelect(id,on){this.fileSelected={...this.fileSelected,[String(id)]:!!on}},fileSelectAll(on){this.fileSelected=Object.fromEntries(this.fileManageRows.map(x=>[String(x.id),!!on]))},requestToggleStudent(id,on){this.requestStudentSelected={...this.requestStudentSelected,[String(id)]:!!on}},requestSelectAll(){const all=this.adminStudentsRows.length&&this.adminStudentsRows.every(x=>this.requestStudentSelected[String(x.studentId)]);this.requestStudentSelected=Object.fromEntries(this.adminStudentsRows.map(x=>[String(x.studentId),!all]))},async loadAssignedRequests(){
        try{
          const d=await window.apiCache.get('/api/requests',{ttl:15000,fetchOpts:{headers:{Authorization:'Bearer '+localStorage.getItem('adminToken')}}});
          this.assignedRequests=Array.isArray(d)?d:[];
          this.requestNotice='';
        }catch(e){
          // Never represent a network timeout as an empty database.
          this.requestNotice=/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(String(e))
            ?'指定申请服务暂时无法连接。请检查网络和 Cloudflare Pages Functions／Gitee 状态，然后点击“刷新”重试；已有列表不会被清空。'
            :(e.message||'无法读取指定申请，请稍后重试');
        }
      },async createAssignedRequest(){
        if(this.requestBusy)return;
        const ids=Object.keys(this.requestStudentSelected).filter(k=>this.requestStudentSelected[k]);
        if(!this.requestTitle.trim()||!ids.length){this.requestNotice='请填写活动名称并选择学生';return;}
        let expiresAt=null;
        if(this.requestExpiryMode==='date'){
          expiresAt=new Date(this.requestExpiresAt).getTime();
          if(!Number.isFinite(expiresAt)||expiresAt<=Date.now()){this.requestNotice='请选择未来截止时间';return;}
        }
        this.requestBusy=true;this.requestNotice='';
        try{
          const r=await window.operationFetch('发送指定申请','/api/requests',{
            method:'POST',
            headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('adminToken')},
            body:JSON.stringify({title:this.requestTitle,description:this.requestDescription,studentIds:ids,attachmentRequired:this.requestAttachmentRequired,expiryMode:this.requestExpiryMode,expiresAt,durationValue:this.requestDurationDays})
          });
          const d=await r.json().catch(()=>({}));
          if(!r.ok)throw Error(d.error||`发送失败（HTTP ${r.status}）`);
          this.requestTitle='';this.requestDescription='';this.requestStudentSelected={};
          window.apiCache?.invalidate('/api/requests');await this.loadAssignedRequests();window.syncBus?.emit('requests',{});
          this.requestNotice='申请已发送';
        }catch(e){
          // A broken POST connection has an unknown server outcome: never auto-retry.
          this.requestNotice=/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(String(e))
            ?'发送结果未知：网络连接中断。请先点击“刷新”查看是否已经发送成功，确认未发送后再重试，避免重复创建申请。'
            :(e.message||'发送失败，请稍后重试');
        }finally{this.requestBusy=false;}
      },async loadAssignedStudentTasks(){const u=this.indexUser,token=localStorage.getItem('studentToken'),studentId=String(u?.studentId||'');if(!studentId||!token){this.indexAssignedTasks=[];this.taskForms={};return;}try{const d=await window.apiCache.get('/api/requests',{ttl:15000,fetchOpts:{headers:{Authorization:'Bearer '+token}}});if(localStorage.getItem('studentToken')!==token||String(this.indexUser?.studentId||'')!==studentId)return;this.indexAssignedTasks=Array.isArray(d)?d:[];const forms={...this.taskForms};this.indexAssignedTasks.forEach(t=>{if(!forms[t.id])forms[t.id]={activityName:'',participants:'',location:'',activityTime:'',images:[],attachment:null,busy:false,error:''}});this.taskForms=forms;}catch(e){if(localStorage.getItem('studentToken')===token){this.indexAssignedTasks=[];console.warn('[assigned student tasks]',e)}}},async submitAssignedTask(t){const f=this.taskForms[t.id];if(!f||f.busy)return;if(!f.activityName.trim()||!f.location.trim()||!f.images.length||(t.attachmentRequired&&!f.attachment)){f.error='请填写必填信息并上传活动图片'+(t.attachmentRequired?'及附件':'');return;}f.busy=true;f.error='';const form=new FormData();form.append('taskId',t.id);form.append('activityName',f.activityName);form.append('participants',f.participants);form.append('location',f.location);form.append('activityTime',f.activityTime);f.images.forEach(x=>form.append('images',x));if(f.attachment)form.append('attachment',f.attachment);try{const r=await window.operationFetch('提交指定申请','/api/requests',{method:'POST',headers:{Authorization:'Bearer '+localStorage.getItem('studentToken')},body:form});const d=await r.json();if(!r.ok)throw Error(d.error||'提交失败');window.flashSuccess?.('申请提交成功');await this.loadAssignedStudentTasks();}catch(e){f.error=e.message}finally{f.busy=false}},
      indexCloseAnnouncement(){this.indexAnnouncementOpen=false;if(window.parent!==window)window.parent.postMessage({type:'credit-fullscreen-announcement',open:false},location.origin);},
      creditSubmissionTime(a){const ts=a?.submittedAt||a?.updatedAt||a?.createdAt;return ts?new Date(ts).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):(a?.publisher||'未记录');},
      toggleFileEntrance(){if(this.fileEntranceSaving||this.fileTasksLoading)return;this.fileEntranceEnabled=!this.fileEntranceEnabled;void this.saveFileEntrance();},
      async saveFileEntrance(){if(this.fileEntranceSaving)return;this.fileEntranceSaving=true;try{const r=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('adminToken')},body:JSON.stringify({fileUploadEnabled:this.fileEntranceEnabled})});if(!r.ok){const d=await r.json().catch(()=>({}));throw Error(d.error||'入口设置保存失败');}window.flashSuccess?.('文件上传入口已'+(this.fileEntranceEnabled?'开启':'关闭'));window.apiCache?.invalidate('/api/settings');window.syncBus?.emit('settings',{});}catch(e){this.fileEntranceEnabled=!this.fileEntranceEnabled;window.flashError?.(e.message||'入口设置保存失败');}finally{this.fileEntranceSaving=false;}},
      async loadFileTasks(silent=false){if(this._fileTasksPromise)return this._fileTasksPromise;const background=silent===true&&this.fileTaskLoaded;this.fileTaskRefreshing=true;if(!background)this.fileTasksLoading=true;if(!background)this.fileTaskError='';this._fileTasksPromise=(async()=>{try{const r=await fetch('/api/file-tasks',{cache:'no-store',headers:{Authorization:'Bearer '+(page==='file-upload'?localStorage.getItem('studentToken'):localStorage.getItem('adminToken'))}});if(!r.ok){const detail=await r.json().catch(()=>({}));throw Error(detail.error||(r.status===401?'学生登录已失效，请重新登录':'任务加载失败（HTTP '+r.status+'）'));}const tasks=await r.json();if(!Array.isArray(tasks))throw Error('任务数据格式错误');if(page==='file-upload'){
        const submitted=new Set(this.fileTasks.filter(task=>task.submitted).map(task=>task.id));
        for(const task of tasks)if(submitted.has(task.id))task.submitted=true;
      }this.fileTasks=tasks;this.fileTaskLoaded=true;this.fileTaskError='';this.fileTaskSelected=Object.fromEntries(Object.entries(this.fileTaskSelected).filter(([id,v])=>v&&tasks.some(t=>t.id===id)));if(page==='file-upload'&&this.fileTaskId&&(!tasks.some(t=>t.id===this.fileTaskId)||tasks.find(t=>t.id===this.fileTaskId)?.deletedAt)){this.fileTaskId='';this.fileUploadCountdown='';window.flashError?.('该任务已被管理员删除');}if(page==='admin'){const config=await fetch('/api/settings',{cache:'no-store'});if(config.ok&&!this.fileEntranceSaving)this.fileEntranceEnabled=(await config.json()).fileUploadEnabled!==false;}}catch(e){if(!background)this.fileTaskError=e.message;else console.warn('[file task background refresh]',e);}finally{this.fileTaskRefreshing=false;this.fileTasksLoading=false;this._fileTasksPromise=null;}})();return this._fileTasksPromise;},
      fileTaskEnded(t){return !!t.deletedAt||t.fileUploadEnabled===false||!!(t.fileUploadDeadlineEnabled&&Number(t.fileUploadDeadline)<=Date.now());},
      selectAllFileTasks(){if(this.fileActionBusy||this.fileTasksLoading)return;const all=this.fileTasks.every(t=>this.fileTaskSelected[t.id]);this.fileTaskSelected=all?{}:Object.fromEntries(this.fileTasks.map(t=>[t.id,true]));},
      async deleteSelectedFileTasks(){if(this.fileActionBusy||this.fileTasksLoading)return;const ids=this.fileTasks.filter(t=>this.fileTaskSelected[t.id]).map(t=>t.id);if(!ids.length)return;const ok=await new Promise(resolve=>window.showConfirm('批量删除文件任务','确定删除选中的 '+ids.length+' 个任务？删除后学生卡片显示“已被管理员删除”，已上传文件保留。','删除所选','取消',resolve));if(!ok)return;this.fileActionBusy=true;try{const r=await window.operationFetch('批量删除文件任务','/api/file-tasks',{method:'DELETE',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('adminToken')},body:JSON.stringify({ids})});const d=await r.json();if(!r.ok)throw Error(d.error||'删除失败');this.fileTaskSelected={};await this.loadFileTasks();window.syncBus?.emit('files',{});}catch(e){window.flashError?.(e.message);}finally{this.fileActionBusy=false;}},
      async deleteFileTask(t){if(!t||this.fileActionBusy)return;if(page==='file-upload'&&!this.fileTaskEnded(t))return;const ok=await new Promise(resolve=>window.showConfirm('删除文件任务',page==='file-upload'?'从你的任务列表移除此已结束任务？':'删除后将停止接收上传，学生卡片会标注“已被管理员删除”。已上传文件保留。','删除','取消',resolve));if(!ok)return;this.fileActionBusy=true;try{const r=await window.operationFetch('删除文件任务','/api/file-tasks',{method:'DELETE',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem(page==='file-upload'?'studentToken':'adminToken')},body:JSON.stringify({id:t.id})});const d=await r.json();if(!r.ok)throw Error(d.error);this.fileActionBusy=false;if(this.fileTaskDetailOpen)this.fileTaskDetailClose();await this.loadFileTasks();window.syncBus?.emit('files',{});}catch(e){window.flashError?.(e.message);}finally{this.fileActionBusy=false;}},
      async loadFileTaskStudents(){if(!this.isSystem)return;this.fileTaskStudentsLoading=true;this.fileTaskStudentsError='';try{const r=await fetch('/api/file-tasks?scope=students',{headers:{Authorization:'Bearer '+localStorage.getItem('adminToken')},cache:'no-store'});if(!r.ok)throw Error('学生名单加载失败');this.fileTaskStudents=await r.json();}catch(e){this.fileTaskStudentsError=e.message;}finally{this.fileTaskStudentsLoading=false;}},
      fileTaskOpen(id){if(id==='legacy'?![...(this.fileRows||[]),...(this.tool?.files||[])].some(r=>!r.taskId||r.taskId==='legacy'):!this.fileTasks.some(t=>t.id===id))return;this.fileManageTask=id;if(page==='admin-tools')return;this.fileSelected={};this.fileTaskId=id==='legacy'?'':id;this.fileTaskChoose();void this.loadFileTaskStudents();if(typeof page!=='undefined'&&page==='admin'){this.fileTaskDetailOpen=true;this.$nextTick(()=>this.$refs.fileTaskDetailDialog?.focus());}},
      fileTaskDetailClose(){if(this.adminUploadSaving||this.fileActionBusy)return;this.fileTaskDetailOpen=false;this.fileManageTask=null;this.fileTaskId='';this.fileSelected={};this.adminUploadSaveResult='';},
      fileTaskCreate(){if(this.adminUploadSaving)return;this.fileTaskRequirementEnabled=false;this.fileTaskRequirementMessage='';this.fileTaskAudience='all';this.fileTaskRecipients={};this.fileTaskStudentSearch='';void this.loadFileTaskStudents();this.fileTaskId='';this.fileTaskTitle='';this.fileTaskDescription='';this.fileTaskError='';this.adminUploadSaveResult='';this.adminUploadSaveError=false;this.adminUploadEnabled=true;this.adminUploadMultiple=true;this.adminUploadMaxSubmissions=1;this.adminUploadFileSizeMode='20';this.adminUploadCustomSize=20;this.adminUploadDeadlineMode='none';this.adminUploadDate='';this.adminUploadHours=0;this.adminUploadMinutes=0;this.adminUploadSeconds=0;this.fileTaskCreateOpen=true;this.$nextTick(()=>this.$refs.fileTaskCreateDialog?.focus());},
      fileTaskCreateClose(){if(this.adminUploadSaving)return;this.fileTaskCreateOpen=false;this.fileTaskId=this.fileManageTask&&this.fileManageTask!=='legacy'?this.fileManageTask:'';this.fileTaskChoose();},
      fileTaskChoose(){const t=this.fileTasks.find(t=>t.id===this.fileTaskId);this.fileTaskRequirementEnabled=t?.uploadRequirementEnabled===true;this.fileTaskRequirementMessage=t?.uploadRequirementMessage||'';this.fileTaskAudience=t?.audience||'all';this.fileTaskRecipients=Object.fromEntries((t?.studentIds||[]).map(id=>[String(id),true]));this.fileTaskTitle=t?.title||'';this.fileTaskDescription=t?.description||'';if(t){this.adminUploadEnabled=t.fileUploadEnabled;this.adminUploadMultiple=t.allowMultipleFiles;this.adminUploadMaxSubmissions=t.maxSubmissionsPerStudent;this.adminUploadFileSizeMode=['20','50','100'].includes(String(t.maxFileSizeMB))?String(t.maxFileSizeMB):'custom';this.adminUploadCustomSize=t.maxFileSizeMB;this.adminUploadDeadlineMode=t.fileUploadDeadlineEnabled?'date':'none';this.adminUploadDate=t.fileUploadDeadline?new Date(t.fileUploadDeadline-new Date(t.fileUploadDeadline).getTimezoneOffset()*60000).toISOString().slice(0,16):'';}},
      async saveFileTask(payload){if(this.fileTaskRequirementEnabled&&!this.fileTaskRequirementMessage.trim())throw Error('请填写上传要求弹窗内容');if(!this.fileTaskTitle.trim())throw Error('请填写上传任务名称');if(this.fileTaskAudience==='selected'&&!Object.values(this.fileTaskRecipients).some(Boolean))throw Error('请选择接收学生');const r=await window.operationFetch(this.fileTaskId?'保存上传任务':'发布上传任务','/api/file-tasks',{method:this.fileTaskId?'PUT':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('adminToken')},body:JSON.stringify({...payload,uploadRequirementEnabled:this.fileTaskRequirementEnabled,uploadRequirementMessage:this.fileTaskRequirementMessage,audience:this.fileTaskAudience,studentIds:Object.keys(this.fileTaskRecipients).filter(id=>this.fileTaskRecipients[id]),id:this.fileTaskId,title:this.fileTaskTitle,description:this.fileTaskDescription})});const d=await r.json();if(!r.ok)throw Error(d.error);this.fileTaskId=d.task.id;if(this.fileTaskCreateOpen){this.fileTaskCreateOpen=false;this.fileManageTask=d.task.id;this.fileSelected={};this.changeTab('files');}await this.loadFileTasks();window.syncBus?.emit('messages',{});},
      async entryCountdownRefresh(settings){
        try{
          let state=settings || await window.apiCache.get('/api/settings?scope=shutdown',{ttl:0});
          if(this._isBeingDestroyed)return;
          const revision=Number(state.systemShutdownUpdatedAt||0);
          if(revision < (this._systemStatus?.systemShutdownUpdatedAt||0))return;
          if(settings && !Object.hasOwn(settings,'enabled'))state={...this._systemStatus,...settings};
          this._systemClosesAt=state.systemClosesAt;
          this._entryClosesAt=state.enabled!==false?state.entryClosesAt:null;
          this._systemStatus=state;
          window.CreditPreloadAnnouncementTheme?.(state.announcementTheme);
          if(window.parent!==window)window.parent.postMessage({type:'credit-system-deadline',at:state.systemClosesAt,closed:state.systemClosed,revision,theme:state.announcementTheme},location.origin);
          if(page==='index' && !state.systemClosed && (!state.systemClosesAt || Date.now()<state.systemClosesAt))window.dispatchEvent(new CustomEvent('credit-system-status',{detail:state}));
          this.entryCountdownTick();
        }catch(_){}
      },
      entryCountdownTick(){
        clearTimeout(this._entryClock);
        const now=Date.now();
        const systemAt=Number(this._systemClosesAt)||0;
        const at=systemAt||Number(this._entryClosesAt)||0;
        const remaining=at-now;
        const holdingZero=systemAt>0 && remaining<=0 && remaining>-1000;
        const waitingForNotice=page==='index' && systemAt>0 && remaining<=0 && !this.indexSystemNoticeOpen;
        const left=Math.max(0,Math.ceil(remaining/1000));
        this.entryCountdown=left>0||holdingZero||waitingForNotice
          ? (systemAt?'离停止服务还有：':'离学分入口关闭还有：')+Math.floor(left/86400)+'天'+Math.floor(left%86400/3600)+'小时'+Math.floor(left%3600/60)+'分钟'+left%60+'秒'
          : '';
        if(remaining>0){
          this._entryClock=setTimeout(()=>this.entryCountdownTick(),remaining%1000||1000);
        }else if(holdingZero){
          this._entryClock=setTimeout(()=>this.entryCountdownTick(),remaining+1000);
        }else if(page==='index'&&systemAt>0){
          const state=this._systemStatus;
          window.dispatchEvent(new CustomEvent('credit-system-status',{detail:{
            ...state,systemClosed:true,announcementTitle:'学分服务中心已停止服务',
            announcementMessage:String(state?.manualAnnouncementMessage||'').trim()||'学分服务中心已停止服务，请留意后续通知。'
          }}));
        }
      },
      async scheduleLoad(){try{const r=await fetch('/api/settings',{cache:'no-store'});if(!r.ok)throw Error('定时设置加载失败');const d=await r.json();for(const rule of d.schedules||[]){if(!rule.active||!this.scheduleForms[rule.target])continue;this.scheduleForms[rule.target][rule.value?'open':'close']={mode:rule.mode==='once'?'date':'daily',at:rule.mode==='once'?new Date(Date.parse(rule.at)+8*3600000).toISOString().slice(0,16):rule.at,hours:0,minutes:0};}this.scheduleReady=true;}catch(e){this.scheduleError=e.message;}},
      schedulePayload(target){
        if(!this.scheduleReady)throw Error('定时设置尚未加载完成，请稍后重试');
        const schedules=[];
        for(const key of ['open','close']){const form=this.scheduleForms[target][key];if(form.mode==='none')continue;let at,mode='once';
          if(form.mode==='duration'){const ms=(Number(form.hours)*60+Number(form.minutes))*60000;if(!Number.isFinite(ms)||ms<=0)throw Error('请填写有效的定时时长');at=new Date(Date.now()+ms).toISOString();}
          else if(form.mode==='daily'){if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.at))throw Error('请选择每天执行的时间');at=form.at;mode='daily';}
          else{const time=Date.parse(form.at+':00+08:00');if(!Number.isFinite(time))throw Error('请选择有效日期时间');at=new Date(time).toISOString();}
          schedules.push({target,mode,at,value:key==='open',active:true});
        }
        return {scheduleTarget:target,schedules};
      },
      settingsHost(){try{return window.parent!==window?window.parent.CreditMusicHost:window.CreditMusicHost;}catch(_){return null;}},
      settingsMusicRead(){
        const host=this.settingsHost();
        let opts={};try{opts=JSON.parse(localStorage.getItem('credit:nbs:options:v2')||'{}')||{}}catch(_){}
        if(host?.getSettings)opts=host.getSettings();
        this.settingsMusic={enabled:opts.enabled!==false,showIsland:opts.showIsland!==false,autoPlay:!!opts.autoPlay,mode:['sequence','shuffle','repeat-one'].includes(opts.mode)?opts.mode:'sequence'};
        this.settingsCacheCount=host?.getSettings?.().cacheCount ?? null;
      },
      settingsThemeSet(mode){if(!['light','dark'].includes(mode))return;this.settingsTheme=window.CreditTheme?.set(mode)||mode;},
      settingsMusicSet(key,value){
        if(!['enabled','showIsland','autoPlay','mode'].includes(key))return;
        if(key==='mode'&&!['sequence','shuffle','repeat-one'].includes(value))return;
        this.settingsMusic={...this.settingsMusic,[key]:value};
        const host=this.settingsHost();
        if(host?.updateSettings){host.updateSettings({[key]:value});}
        else {
          let saved={};try{saved=JSON.parse(localStorage.getItem('credit:nbs:options:v2')||'{}')||{}}catch(_){}
          try{localStorage.setItem('credit:nbs:options:v2',JSON.stringify({...saved,[key]:value}));}catch(_){}
        }
        this.settingsNotice='偏好已保存';
      },
      settingsOpenMusic(){const host=this.settingsHost();if(host?.open)host.open();else if(window.parent!==window)window.parent.postMessage({type:'credit-music:open'},location.origin)},
      async settingsClearMusicCache(){
        if(this.settingsBusy)return;this.settingsBusy=true;this.settingsNotice='';
        try{
          const host=this.settingsHost();
          if(host?.clearCache)await host.clearCache();
          else if('caches' in window)await caches.delete('credit-nbs-mp3-v3');
          this.settingsCacheCount=0;this.settingsNotice='缓存已清理';
        }catch(e){this.settingsNotice=e?.message||'缓存清理失败';}
        finally{this.settingsBusy=false;}
      },
      adminImportPickFile(event){this.adminImportFile=event.target.files?.[0]||null;this.adminImportResult='';this.adminImportFailures=[];this.adminImportVisible=false;},
      adminSelectStudent(id,checked){this.adminStudentSelected={...this.adminStudentSelected,[String(id)]:!!checked}},
      adminSelectAllStudents(checked){this.adminStudentSelected=Object.fromEntries(this.adminStudentsRows.map(s=>[String(s.studentId),!!checked]))},
      adminToggleMessageStudent(id,checked){this.adminMessageSelected={...this.adminMessageSelected,[String(id)]:!!checked}},
      adminSelectAllMessageStudents(checked){this.adminMessageSelected=Object.fromEntries(this.adminMessageStudents.map(s=>[String(s.studentId),!!checked]))},
      adminFormatTime(value){if(!value)return '-';const d=new Date(value);return Number.isNaN(d.getTime())?'-':d.toLocaleString('zh-CN')},
      selectAllStudents(checked){this.selectedStudentIds=Object.fromEntries(this.studentsRows.map(s=>[String(s.studentId),!!checked]));},
      toggleStudentSelected(id,checked){this.selectedStudentIds={...this.selectedStudentIds,[String(id)]:!!checked};},
      dashboardFilter(items){const q=this.dashboardSearch.toLowerCase();return items.filter(a=>!q||[a.name,a.packageName,a.versionName,a.publisher,a.participants].some(x=>String(x||'').toLowerCase().includes(q)));},
      selectDashboardTab(tab){
        if(!['pending','approved','assigned'].includes(tab))return;
        if(tab==='assigned'&&!this.dashboardCanAssign)return;this.dashboardActiveTab=tab;this.dashboardSearch='';if(tab==='assigned')void this._dashboardApi?.loadAssigned();
      },
      dashboardRefresh(){
        if(this.dashboardBusy||this.dashboardRefreshing)return;
        return this.dashboardActiveTab==='assigned'?this._dashboardApi?.loadAssigned(true):this._dashboardApi?.loadApps(true);
      },
      dashboardOpen(app,readOnly=false){
        if(this.dashboardBusy)return;
        this.dashboardPreviewSrc='';
        this.dashboardModalApp=app;
        this.dashboardModalReadOnly=!!readOnly;
        this.dashboardImageErrors={};this.dashboardReasonMode='';this.dashboardReasonText='';this.dashboardReasonError='';
        this.dashboardActionError='';this.dashboardRejectConfirm=false;
      },
      dashboardClose(){if(this.dashboardBusy)return;this.dashboardPreviewSrc='';this.dashboardModalApp=null;this.dashboardReasonMode='';this.dashboardRejectConfirm=false;},
      dashboardImageUrl(file){
        return '/api/screenshots/'+encodeURIComponent(String(this.dashboardModalApp?.id||''))+'/'+String(file||'');
      },
      dashboardSetSelected(id,checked){this.dashboardSelected={...this.dashboardSelected,[String(id)]:!!checked};},
      dashboardToggleAllApproved(checked){
        const selected={...this.dashboardSelected};
        this.dashboardApprovedFiltered.forEach(a=>{selected[String(a.id)]=!!checked;});
        this.dashboardSelected=selected;
      },
      dashboardReview(action){if(action==='approve')return this._dashboardApi?.review('approve');},
      dashboardAskReason(mode){
        if(this.dashboardBusy||!['needs_fix','reject'].includes(mode))return;
        this.dashboardReasonMode=mode;this.dashboardReasonText='';this.dashboardReasonError='';this.dashboardRejectConfirm=false;
      },
      dashboardCancelReason(){if(this.dashboardBusy)return;this.dashboardReasonMode='';this.dashboardReasonText='';this.dashboardReasonError='';this.dashboardRejectConfirm=false;},
      dashboardSubmitReason(){
        if(this.dashboardBusy)return;
        if(!this.dashboardReasonText.trim()){this.dashboardReasonError='请填写原因';return;}
        if(this.dashboardReasonMode==='reject'&&!this.dashboardRejectConfirm){this.dashboardRejectConfirm=true;return;}
        return this._dashboardApi?.review(this.dashboardReasonMode,this.dashboardReasonText);
      },
      dashboardDeleteSelected(){return this._dashboardApi?.deleteApproved();},
      async refreshIndexClick(button){
        if(this.indexRefreshing)return;
        this.indexRefreshing=true;
        try{
          if(this.indexTab==='assigned'){
            window.apiCache?.invalidate('/api/requests');
            if(this.indexLoggedIn)await this.loadAssignedStudentTasks();
            else this.indexAssignedTasks=[];
          }else await this.indexRefresh?.();
          window.flashSuccess?.('已更新学分列表');
        }
        catch(e){window.flashError?.(e.message||'刷新失败');}
        finally{this.indexRefreshing=false;}
      },
      async loadMusicTracks(){this.musicLoading=true;this.musicError='';try{const res=await fetch('/api/music',{cache:'no-store'});const data=await res.json();if(!res.ok||!Array.isArray(data.tracks))throw Error(data.error||'读取音乐列表失败');this.musicTracks=data.tracks;}catch(e){this.musicError=e.message;}finally{this.musicLoading=false}},
      setMusicSelected(id,checked){this.musicSelected={...this.musicSelected,[id]:!!checked}},
      selectAllMusic(on){this.musicSelected=Object.fromEntries(this.musicTracks.map(t=>[t.id,on]))},
      notifyMusicRefresh(){if(window.parent!==window)window.parent.postMessage({type:'credit-music:refresh'},location.origin);else window.CreditMusicHost?.refresh?.()},
      playMusicTrack(id){if(window.parent!==window && window.parent.CreditMusicHost?.play)window.parent.CreditMusicHost.play(id);else if(window.parent!==window)window.parent.postMessage({type:'credit-music:play',id},location.origin);else window.CreditMusicHost?.play?.(id)},
      async importMusicFiles(ev){const files=Array.from(ev.target.files||[]);ev.target.value='';if(!files.length||this.musicBusy)return;this.musicBusy=true;this.musicError='';this.musicPercent=0;let saved=0;const failed=[];try{for(let i=0;i<files.length;i++){const file=files[i];this.musicActionLabel='正在导入 MP3：'+(i+1)+' / '+files.length;this.musicPercent=Math.floor(i/files.length*100);try{const form=new FormData();form.append('file',file);const res=await fetch('/api/music',{method:'POST',headers:{Authorization:'Bearer '+(localStorage.getItem('aboutWriteToken')||''),'X-Account-Session':localStorage.getItem('adminToken')||''},body:form});const data=await res.json();if(!res.ok)throw Error(data.error||'上传失败');saved++;}catch(e){failed.push(file.name+'：'+e.message)}}this.musicPercent=100;await this.loadMusicTracks();this.notifyMusicRefresh();this.musicError=failed.length?'以下文件未导入：'+failed.join('；'):'';if(saved)window.flashSuccess?.('已成功导入 '+saved+' 首 MP3');}finally{this.musicBusy=false}},
      async deleteMusicOne(id){await this.deleteMusicSelected([id])},
      async deleteMusicSelected(ids){
        const selected=(Array.isArray(ids)?ids:this.musicTracks.filter(t=>this.musicSelected[t.id]).map(t=>t.id)).filter(Boolean);
        if(!selected.length || this.musicBusy || this.musicDeleteAsk)return;
        this.musicDeletePending=selected;
        this.musicDeleteAsk=true;
      },
      cancelMusicDelete(){this.musicDeleteAsk=false;this.musicDeletePending=[]},
      async confirmMusicDelete(){
        if(this.musicBusy || !this.musicDeleteAsk)return;
        const selected=[...this.musicDeletePending];this.cancelMusicDelete();
        if(!selected.length)return;
        this.musicBusy=true;this.musicPercent=0;this.musicError='';const errors=[];const removed=new Set();
        try{
          for(let i=0;i<selected.length;i++){
            const id=selected[i], track=this.musicTracks.find(t=>t.id===id);
            this.musicActionLabel='正在删除曲目：'+(i+1)+' / '+selected.length;
            try{
              const res=await fetch('/api/music/'+encodeURIComponent(id),{method:'DELETE',headers:{Authorization:'Bearer '+(localStorage.getItem('aboutWriteToken')||''),'X-Account-Session':localStorage.getItem('adminToken')||''}});
              const data=await res.json().catch(()=>({}));
              if(!res.ok)throw Error(data.error||'删除失败 (HTTP '+res.status+')');
              removed.add(id);
            }catch(e){errors.push((track?.name||id)+'：'+(e.message||'请求失败'))}
            this.musicPercent=Math.round((i+1)/selected.length*100);
          }
          this.musicSelected=Object.fromEntries(Object.entries(this.musicSelected).filter(([id])=>!removed.has(id)));
          await this.loadMusicTracks();this.notifyMusicRefresh();
          if(errors.length)this.musicError='以下曲目删除失败：'+errors.join('；');
          if(removed.size)window.flashSuccess?.('已成功删除 '+removed.size+' 首音乐');
        }catch(e){this.musicError=e.message||'批量删除失败，请重试'}
        finally{this.musicBusy=false}
      },
      goHome() { window.CreditRouteGuard?.navigateAway ? window.CreditRouteGuard.navigateAway('/index.html', false) : window.location.assign('/index.html'); },
      selectApplicationImages(event){return this._applicationApi?.selectImages(event)},
      removeApplicationImage(index){return this._applicationApi?.removeImage(index)},
      loadApplicationRoster(){return this._applicationApi?.loadRoster()},
      retryApplicationEntry(){return this._applicationApi?.checkEntry()},
      submitApplication(){return this._applicationApi?.submit()},
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
          this.adminProgress = {open:true, busy:true, outcome:'', scope:state.scope || '', title:state.title || '正在处理…',
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
        if (!['admin','settings'].includes(page) || !this.isSystem || this.aboutSaving) return;
        this.aboutSaveResult = '';
        const token = localStorage.getItem('aboutWriteToken');
        if (!token) { this.aboutError = '保存需要新的登录凭证。请退出 system 账户后重新登录。'; return; }
        if (!this.aboutInfo.title.trim()) { this.aboutError = '请填写关于页标题'; return; }
        if (this.adminProgress.busy) return;
        this.aboutSaving = true; this.aboutError = '';
        if(page==='admin')this.reportAdminProgress({type:'start', title:'正在保存系统信息…', detail:'正在向 Gitee 提交设置并等待写入确认', indeterminate:true});
        try {
          const response = await fetch('/api/about', {
            method:'PUT', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token,'X-Account-Session':localStorage.getItem('adminToken')||''},
            body: JSON.stringify(this.aboutInfo)
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || '保存失败');
          this.aboutUpdatedAt = data.updatedAt;
          this.aboutSaveResult = '已保存到 Gitee，关于页面将显示最新信息';
          if(page==='admin')this.reportAdminProgress({type:'success', title:'系统信息保存成功', detail:'Gitee 已确认写入，关于页面将显示最新内容'});
          window.flashSuccess?.('关于信息已保存');
        } catch(error) { this.aboutError = error.message || '保存失败，请重试';
          if(page==='admin')this.reportAdminProgress({type:'error', title:'系统信息保存失败', detail:this.aboutError}); }
        finally { this.aboutSaving = false; }
      },
      refreshPageAction(name, btn) {
        if (!window.CreditRefresh?.run) return this.invokePageAction(name, true);
        return window.CreditRefresh.run(btn, () => this.invokePageAction(name, true));
      },
      async invokePageAction(name, ...args) {
        const btn = args.find(a => a && a.nodeType === 1);
        if ((name === 'importStudents' && this.adminImportBusy) || (name === 'exportSubmissionExcel' && this.adminExcelExportBusy)) return;
        if (['importStudents','exportSubmissionExcel'].includes(name)) {
          const oldText = btn?.textContent;
          if (btn) { btn.disabled = true; btn.textContent = '正在准备组件…'; }
          try {
            if (name === 'importStudents' && document.querySelector('#fileInput')?.files?.[0]?.name?.toLowerCase().endsWith('.xls')) {
              await injectScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
            } else await loadSpreadsheet();
          } catch(err) { window.flashError?.(err.message || '组件加载失败'); return; }
          finally { if (btn) { btn.disabled = false; btn.textContent = oldText; } }
        }
        const action = window[name];
        if (typeof action === 'function') return action(...args);
        window.flashError?.('操作尚未初始化，请稍后重试');
      },
      changeTab(tab) {
        if(tab==='about'){window.location.replace('/settings.html?view=admin#about-system');return;}
        const allowed = ['admins','students','messages','tools','files','requests','request-activities','maintenance','logs','about'];
        if (!allowed.includes(tab)) return;
        if (Object.hasOwn(this.adminTabPermissions,tab) && !this.adminTabPermissions[tab]) return;
        this.activeTab = tab;
        if(tab==='maintenance')void this.loadAccountSecurity();
        this._tabReady = true;
        
        if (page === 'admin') {
          history.replaceState(history.state, '', tab === 'admins' ? '/admin.html' : '/admin.html?tab=' + tab);
          window.__onAdminTabChange?.(tab);
          // Vue-managed management lists: request after the tab becomes active.
          if(['requests','request-activities'].includes(tab)){ void this.loadAssignedRequests(); if(!this.adminStudentsRows.length) void this.invokePageAction('loadStudents'); }
          if(tab==='messages') void this.invokePageAction('loadMsgStudentList');
          if(tab==='logs') void this.invokePageAction('loadLogs');
        }
      },
      async checkSystemStatus() {
        this.systemStatus = 'checking';
        this.systemStatusError = '';
        try {
          const response = await fetch('/api/admin/check-system', {cache: 'no-store'});
          const data = await response.json().catch(() => null);
          if (!response.ok || !data || typeof data.exists !== 'boolean') {
            if (data?.code === 'GITEE_CONFIG_MISSING') {
              this.systemStatusError = 'Cloudflare Pages 的环境变量尚未配置完整。请在该 Pages 项目的「设置 → 变量和密钥」中检查 Gitee 配置（生产环境和预览环境分别确认），保存后重新部署。';
            } else {
              this.systemStatusError = String(data?.error || `无法确认系统初始化状态（HTTP ${response.status}）`);
            }
            this.systemStatus = 'error';
            return;
          }
          this.systemStatus = data.exists ? 'initialized' : 'uninitialized';
        } catch (err) {
          this.systemStatusError = '无法连接系统初始化检查服务，请确认网络或后端状态。';
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
          const resp = await fetch('/api/auth', { method: 'POST', headers: await this.loginDeviceHeaders(), body: JSON.stringify({username: this.username.trim(), password: this.password}) });
          const data = await resp.json();
          if(data?.code==='ACCOUNT_BANNED'){(window.parent.CreditAccountNotice||window.CreditAccountNotice)?.('admin','banned',data);throw Error(data.error);}
          if (!resp.ok || !data?.token || !['system','admin'].includes(data?.user?.role)) throw new Error(data?.error || '登录失败');
          localStorage.setItem('adminToken', data.token);
          localStorage.setItem('adminUser', JSON.stringify(data.user));
          if (data.aboutToken) localStorage.setItem('aboutWriteToken', data.aboutToken);
          else localStorage.removeItem('aboutWriteToken');
          window.apiCache?.clear?.();
          window.CreditRouteGuard?.navigateAway ? window.CreditRouteGuard.navigateAway('/home.html?view=admin', true) : window.location.replace('/home.html?view=admin');
        } catch(err) { this.loginError = err.message || '网络错误，请重试'; window.flashError?.(this.loginError); this.loginPending = false; }
      },
      async submitStudentLogin() {
        if (this.loginPending) return;
        this.loginError = '';
        if (!String(this.studentId).trim() || !this.password) { this.loginError = '请填写学号和密码'; return; }
        this.loginPending = true;
        try {
          const resp = await fetch('/api/students?action=verify', { method:'POST', headers:await this.loginDeviceHeaders(), body:JSON.stringify({studentId: String(this.studentId).trim(),password:this.password}) });
          const data = await resp.json();
          if(data?.code==='ACCOUNT_BANNED'){(window.parent.CreditAccountNotice||window.CreditAccountNotice)?.('student','banned',data);throw Error(data.error);}
          if (!resp.ok || !data?.token || data?.user?.studentId == null) throw new Error(data?.error || '登录失败');
          localStorage.setItem('studentToken', data.token);
          localStorage.setItem('studentUser', JSON.stringify(data.user));
          localStorage.setItem('studentAutoLogin', this.autoLogin ? 'true' : 'false');
          window.apiCache?.clear?.();
          const redirect = new URLSearchParams(window.location.search).get('redirect');
          const target = window.CreditRouteGuard?.localPath(redirect, '/home.html') || '/home.html'; window.CreditRouteGuard?.navigateAway ? window.CreditRouteGuard.navigateAway(target, true) : window.location.replace(target);
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
          window.CreditRouteGuard?.navigateAway ? window.CreditRouteGuard.navigateAway('/login.html', true) : window.location.replace('/login.html');
        } catch(err) { this.loginError = err.message || '网络错误，请重试'; this.loginPending = false; }
      }
    },
    async mounted() {
      if(['student','admin-tools'].includes(page))this._accountClock=setInterval(()=>{this.accountSecurityNow=Date.now();},1000);
      if(page==='admin'&&this.activeTab==='about'){window.location.replace('/settings.html?view=admin#about-system');return;}
      document.dispatchEvent(new Event('credit-shell-ready'));
      if(page!=='index' && window.parent!==window)window.parent.postMessage({type:'credit-view-rendered'},location.origin);

      if(page==='admin'&&this.isSystem){
        void this.scheduleLoad();
        if(this.activeTab==='maintenance')void this.loadAccountSecurity();
        this._accountClock=setInterval(()=>{if(['maintenance','students'].includes(this.activeTab))this.accountSecurityNow=Date.now();},1000);
        this._accountStatusTimer=setInterval(()=>{if(this.activeTab==='maintenance'&&!document.hidden&&!this.accountSecurityBusy&&!this.accountPolicyBusy&&!this.accountRiskSaving)void this.loadAccountSecurity(true);},2000);
      }
      if(['admin','admin-tools'].includes(page))void this.loadFileTasks();
      if(page==='index'){
        this._shutdownSync=window.syncBus?.on('settings',update=>{
          if(update?.action==='system-shutdown' && Number.isFinite(update.status?.systemShutdownUpdatedAt)){
            void this.entryCountdownRefresh(update.status);
          }
        });
        this._refreshShutdown=()=>{
          if(document.hidden||navigator.onLine===false)return;
          this.entryCountdownTick();
          void this.entryCountdownRefresh();
        };
        document.addEventListener('visibilitychange',this._refreshShutdown);
        window.addEventListener('online',this._refreshShutdown);
        window.addEventListener('focus',this._refreshShutdown);
        if(page==='index'&&window.__creditInitialSettings)void window.__creditInitialSettings.then(settings=>{if(!this._isBeingDestroyed)void this.entryCountdownRefresh(settings);});
        else void this.entryCountdownRefresh(window.__fileUploadSettings);
        this._entryPoll=setInterval(this._refreshShutdown,2000);
      }
      if (page === 'login') {
        try { await this.checkSystemStatus(); }
        catch (err) { console.error('[login page init]', err); window.flashError?.('登录页面初始化失败，请刷新重试'); }
        finally { window.__appReady = true; try { performance.mark('credit:viewready'); } catch (_) {} document.dispatchEvent(new Event('viewready')); }
        return;
      }
      if (page === 'student-login' || page === 'create-system' || page === 'close') {
        window.__appReady = true; document.dispatchEvent(new Event('viewready'));
        return;
      }
      if (page === 'settings') {
        this.settingsMusicRead();
        if(this.isSystem)void this.loadAboutInfo();
        this._settingsThemeHandler=()=>{this.settingsTheme=window.CreditTheme?.read()||'light';};
        this._settingsMusicHandler=()=>this.settingsMusicRead();
        document.addEventListener('credit-theme-changed',this._settingsThemeHandler);
        window.addEventListener('storage',this._settingsMusicHandler);
        window.__appReady=true;document.dispatchEvent(new Event('viewready'));
        return;
      }
      if (page === 'about') {
        try { await this.loadAboutInfo(); }
        catch (err) { console.error('[about page init]', err); window.flashError?.('关于页面初始化失败，请刷新重试'); }
        finally { window.__appReady = true; try { performance.mark('credit:viewready'); } catch (_) {} document.dispatchEvent(new Event('viewready')); }
        return;
      }
      if (page === 'music') {
        try { await this.loadMusicTracks(); }
        catch (err) { console.error('[music page init]', err); window.flashError?.('音乐盒页面初始化失败，请刷新重试'); }
        finally { window.__appReady = true; try { performance.mark('credit:viewready'); } catch (_) {} document.dispatchEvent(new Event('viewready')); }
        return;
      }
      if (page === 'upload') window.__setUploadProgress = (state, percent, error) => this.updateUploadProgress(state, percent, error);
      if (page === 'detail') this.detailLoading=true;
      
      if (page === 'admin') {
        window.__vueAdminUpdate = data => { if (adminPermissionsSaving) return; this.adminRows = Array.isArray(data) ? data.map(v=>({...v})) : []; this.adminListError=''; if(Object.hasOwn(this.adminTabPermissions,this.activeTab) && !this.adminTabPermissions[this.activeTab]) this.changeTab('admins'); };
        window.__vueAdminError = message => { this.adminListError = message; };
        window.__vueFileRows = rows => { this.fileRows=Array.isArray(rows)?rows:[];this.fileError='';this.fileLoading=false; };
        window.__vueFileError = message => { this.fileError=String(message||'读取文件列表失败');this.fileLoading=false; };
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
        this._cacheUpdate=e=>{const {url,data}=e.detail||{};if(page==='detail'&&!this.detailCanEdit&&!this.detailBusy&&['/api/apps','/api/requests','/api/requests?scope=published'].includes(url))void this.detailApi?.reload?.();if(url==='/api/apps'){if(page==='index')this.indexApps=data;if(page==='dashboard')this.dashboardApps=data;}if(url==='/api/requests?scope=published'&&page==='index')this.indexPublishedTasks=data;if(url==='/api/requests'){if(page==='index')this.indexAssignedTasks=data;if(page==='admin')this.assignedRequests=data;if(page==='dashboard'&&this.dashboardActiveTab==='assigned')void this._dashboardApi?.loadAssigned();}};
        window.addEventListener('credit-api-updated',this._cacheUpdate);
        // Vue owns view lifecycle. Existing API workflows are scoped to one page
        // controller, rather than injected as global, persistent legacy scripts.
        const module = await import('/assets/controllers/' + page + '.mjs?v=' + (page === 'admin' ? '3.9.122' : page === 'dashboard' ? '3.9.128' : page === 'student' ? '3.9.99' : page === 'admin-tools' ? '3.9.99' : page === 'upload' ? '3.9.126' : page === 'index' ? '3.9.121' : page === 'file-upload' ? '3.9.52' : page === 'assigned-request' ? '3.9.45' : page === 'index' ? '3.9.45' : page === 'detail' ? '3.9.110' : page === 'messages' ? '3.9.121' : page === 'upload' || page === 'file-upload' || page === 'admin-tools' || page === 'admin' || page === 'dashboard' ? '3.9.45' : '3.7.2'));
        if (this._isBeingDestroyed || this._isUnmounted) return;
        const cleanup = module.mount(['admin-tools','index','messages','student','file-upload','detail','assigned-request','admin','dashboard','upload'].includes(page) ? this : undefined);
        this._controllerCleanup = typeof cleanup === 'function' ? cleanup : null;

        if (page === 'admin' && this.activeTab !== 'admins') window.__onAdminTabChange?.(this.activeTab);
        if(page==='admin'&&['requests','request-activities'].includes(this.activeTab)){void this.loadAssignedRequests();if(!this.adminStudentsRows.length)void this.invokePageAction('loadStudents');}
        window.__appReady = true;
        try { performance.mark('credit:viewready'); } catch (_) {}
        document.dispatchEvent(new Event('viewready'));
      } catch(err) {
        console.error('[Vue page controller]', err);
        const message='页面初始化失败，请刷新重试';
        if(page==='detail'){this.detailLoading=false;this.detailError=message;}
        if(page==='assigned-request'){this.assignedPageLoading=false;this.assignedPageError=message;}
        window.flashError?.(message);
      }
      finally { window.__appReady = true; try { performance.mark('credit:viewready'); } catch (_) {} document.dispatchEvent(new Event('viewready')); }
    },
    beforeUnmount() {
      if(this._refreshShutdown){
        document.removeEventListener('visibilitychange',this._refreshShutdown);
        window.removeEventListener('online',this._refreshShutdown);
        window.removeEventListener('focus',this._refreshShutdown);
      }
      this._shutdownSync?.();clearInterval(this._accountClock);clearInterval(this._accountStatusTimer);clearTimeout(this._entryClock);clearInterval(this._entryPoll); window.removeEventListener('credit-api-updated',this._cacheUpdate); if(page==='settings'){document.removeEventListener('credit-theme-changed',this._settingsThemeHandler);window.removeEventListener('storage',this._settingsMusicHandler);} this._isBeingDestroyed = true; if (page === 'upload') window.__setUploadProgress = null; if (page === 'admin') { window.__vueFileRows=null; window.__vueFileError=null; window.__adminProgressReport = null; window.removeEventListener('beforeunload', this._busyUnloadHandler); window.removeEventListener('keydown', this._busyKeyHandler, true); } this._controllerCleanup?.(); }
  };
  const app = createApp({
    components: { PageContent },
    setup() {
      if(page==='upload'&&!window.__routePreflightPromise)window.__routePreflightPromise=window.CreditRouteGuard?.beforeVisit(window.location.href);
      const routePending=ref(!!window.__routePreflightPromise),routeError=ref('');
      const routeStatus=page==='upload'?'正在确认学分申请入口状态…':page==='file-upload'?'正在确认文件上传入口状态…':'正在确认系统初始化状态…';
      const retryRoute=()=>window.location.reload();
      const isMobile = ref(media.matches);
      const showMenu = ref(false);
      const tabLoading = ref('');
      let tabLoadingTimer;
      const showTabLoading = event => {
        const target = event.target;
        const tab = event.type === 'change'
          ? target.closest?.('.admin-mobile-tab-select select')
          : target.closest?.('.tab-btn, [role="tab"], .modal-tabs button');
        if (!tab || tab.disabled || tab.classList.contains('active') || tab.getAttribute('aria-selected') === 'true') return;
        const label = tab.selectedOptions?.[0]?.textContent || tab.textContent;
        tabLoading.value = label.trim();
        clearTimeout(tabLoadingTimer);
        tabLoadingTimer = setTimeout(() => {tabLoading.value = '';}, 450);
      };
      const online = ref(navigator.onLine);
      const themeMode = window.CreditTheme?.useTheme?.() || ref(window.CreditTheme?.read() || 'light');
      const toggleTheme = () => { window.CreditTheme?.toggle(); };
      const syncTheme = () => {themeMode.value=window.CreditTheme?.read() || 'light';};
      const user = ref(adminArea ? safeJSON('adminUser') : safeJSON('studentUser'));
      const hasUser = ref(!!(adminArea ? safeGet('adminToken') : safeGet('studentToken')));
      const sidebarItems = computed(() => {
        if (!adminArea) return navStudent.filter(item => item.href !== '/student-login.html' || !hasUser.value);
        if (user.value.role === 'system') {
          // System student management now lives inside System Management -> Students.
          return navAdmin.filter(item => !['/admin-tools.html','/student.html','/index.html','/login.html'].includes(item.href))
            .concat([{ href: '/login.html', title: '退出登录', icon: '⎋', pages: [], action: 'logout-system' }]);
        }
        // Unchanged admin-account routes and actions.
        return navAdmin.filter(item => !['/admin.html','/music.html'].includes(item.href));
      });
      const workCards = computed(() => {
        const cards = sidebarItems.value.filter(item => Object.hasOwn(workDescriptions,item.href));
        if (adminArea && user.value.role === 'system') {
          cards.push({href:'/admin.html?tab=students',title:'学生管理',pages:[]},
            {href:'/admin.html?tab=maintenance',title:'系统安全',pages:[]});
        }
        return cards;
      });
      const mobileItems = computed(() => sidebarItems.value.slice(0, 4));
      const brandHref = computed(() => adminArea ? adminHome.href : studentHome.href);
      const displayName = computed(() => user.value.name || user.value.username || (adminArea ? '管理账户' : '访客'));
      const homeClock = ref(Date.now());
      const homeChanges = ref([]);
      const homeCountdownStatus = ref('正在读取定时安排…');
      let homeTick, homeRefresh, homeReading = false, unsubscribeHome;
      const homeCountdowns = computed(() => {
        const labels = {system:'停止服务',enabled:'学分入口',fileUploadEnabled:'文件上传入口',announcementEnabled:'公告'};
        return homeChanges.value.filter(item=>item.at>homeClock.value).map(item=>{
          const left = Math.ceil((item.at-homeClock.value)/1000);
          const label = item.target==='system' ? labels.system : labels[item.target]+(item.value?'开启':'关闭');
          return {...item,label,time:Math.floor(left/86400)+'天'+Math.floor(left%86400/3600)+'小时'+Math.floor(left%3600/60)+'分钟'+left%60+'秒'};
        });
      });
      const loadHomeCountdowns = async () => {
        if (document.hidden || homeReading) return;
        homeReading = true;
        try {
          const response = await fetch('/api/settings?scope=countdowns',{cache:'no-store'});
          if (!response.ok) throw Error('定时安排暂不可用');
          const changes = await response.json();
          if (!Array.isArray(changes)) throw Error('定时安排暂不可用');
          homeChanges.value = changes;
          homeCountdownStatus.value = '暂无即将执行的定时安排';
        } catch (_) { homeCountdownStatus.value = '定时安排暂不可用'; }
        finally { homeReading = false; }
      };
      const welcomeName = ref(user.value.welcomeName || '');
      const welcomeReady = ref(!hasUser.value || Object.hasOwn(user.value,'welcomeName'));
      let welcomeRequest = 0;
      const loadWelcomeName = async () => {
        if (page !== 'home') return;
        const requestId = ++welcomeRequest;
        const token = safeGet(adminArea ? 'adminToken' : 'studentToken');
        if (!token) { welcomeName.value = ''; welcomeReady.value = true; return; }
        try {
          const response = await fetch('/api/welcome-name', {headers:{Authorization:'Bearer '+token},cache:'no-store'});
          if (!response.ok) return;
          const result = await response.json();
          if (requestId === welcomeRequest) welcomeName.value = result.name || '';
        } catch (_) {}
        finally { if (requestId === welcomeRequest) welcomeReady.value = true; }
      };
      let unsubscribeWelcome;
      const refreshAccount = () => {
        if (window.__routeNavigationPending) return;
        // Cross-tab sign-out: the current protected view cannot remain on screen.
        const reroute = window.CreditRouteGuard?.destination(window.location.href);
        if (reroute) { window.CreditRouteGuard.navigateAway(reroute, true); return; }
        user.value = adminArea ? safeJSON('adminUser') : safeJSON('studentUser');
        hasUser.value = !!(adminArea ? safeGet('adminToken') : safeGet('studentToken'));
        void loadWelcomeName();
      };
      const active = item => item.pages.includes(page);
      const onNavClick = (event, item) => {
        if (item.action !== 'logout-system') return;
        event.preventDefault();
        window.CreditRouteGuard.logoutAdmin();
      };
      const updateMobile = () => {
        isMobile.value = media.matches;
        document.documentElement.dataset.device = isMobile.value ? 'mobile' : 'desktop';
      };
      const updateOnline = () => { online.value = navigator.onLine; };
      onMounted(() => {
        if(routePending.value){document.dispatchEvent(new Event('credit-shell-ready'));Promise.resolve(window.__routePreflightPromise).then(where=>{if(where){if(!window.__inlineApplicationNotice)window.CreditRouteGuard.navigateAway(where,true);return;}routePending.value=false;}).catch(err=>{console.error('[page preflight]',err);routeError.value='暂时无法确认服务状态，请检查网络后重试';});}
        updateMobile();
        if (page === 'home') {
          if(window.parent!==window)window.parent.postMessage({type:'credit-view-rendered'},location.origin);
          void loadWelcomeName();
          void loadHomeCountdowns();
          homeTick = setInterval(()=>{homeClock.value=Date.now();},1000);
          homeRefresh = setInterval(loadHomeCountdowns,15000);
          unsubscribeHome = window.syncBus?.on('settings',loadHomeCountdowns);
          window.addEventListener('focus',loadHomeCountdowns);
          unsubscribeWelcome = window.syncBus?.on('welcome-name',loadWelcomeName);
          window.addEventListener('focus',loadWelcomeName);
        }
        if (media.addEventListener) media.addEventListener('change', updateMobile);
        else media.addListener(updateMobile);
        window.addEventListener('resize', updateMobile, { passive: true });
        window.addEventListener('online', updateOnline);
        window.addEventListener('offline', updateOnline);
        window.addEventListener('storage', refreshAccount);
        window.addEventListener('credit-auth-changed', refreshAccount);
        document.addEventListener('credit-theme-changed', syncTheme);
      });
      onBeforeUnmount(() => {
        clearTimeout(tabLoadingTimer);
        clearInterval(homeTick);
        clearInterval(homeRefresh);
        unsubscribeHome?.();
        window.removeEventListener('focus',loadHomeCountdowns);
        unsubscribeWelcome?.();
        window.removeEventListener('focus',loadWelcomeName);
        if (media.removeEventListener) media.removeEventListener('change', updateMobile);
        else media.removeListener(updateMobile);
        window.removeEventListener('resize', updateMobile);
        window.removeEventListener('online', updateOnline);
        window.removeEventListener('offline', updateOnline);
        window.removeEventListener('storage', refreshAccount);
        window.removeEventListener('credit-auth-changed', refreshAccount);
        document.removeEventListener('credit-theme-changed', syncTheme);
      });
      return { routePending,routeError,routeStatus,retryRoute,page, titles, isAuth, adminArea, isMobile, showMenu, online, hasUser,
        tabLoading, showTabLoading, sidebarItems, mobileItems, workCards, workDescriptions, brandHref, displayName, welcomeName, welcomeReady, homeCountdowns, homeCountdownStatus, active, onNavClick, iconFor, accountImage, themeMode, toggleTheme, title: titles[page] || '学分服务', user };
    },
    template: `
      <div class="app-frame" :class="{'is-auth': isAuth, 'is-mobile': isMobile, 'is-admin': adminArea}">
        <aside v-if="!isAuth" class="app-sidebar" :class="{'opened':showMenu}" aria-label="功能导航">
          <a class="brand" :href="brandHref" aria-label="学分申请系统首页">
            <span class="brand-mark"><img src="/assets/icons/网页选项卡标题，网站logo.webp" alt="学分服务中心"></span><span class="brand-copy"><b>学分服务中心</b><small>CREDIT SERVICE PORTAL</small></span>
          </a>
          <div class="sidebar-section-label">工作空间</div>
          <nav class="side-nav">
            <a v-for="item in sidebarItems" :key="item.href" :href="item.href"
              class="side-link" :data-nav-action="item.action || null" @click="onNavClick($event,item)" :class="{selected:active(item)}" :aria-current="active(item)?'page':null">
              <span class="side-icon"><img v-if="iconFor(item)" :src="'/assets/icons/'+iconFor(item)" class="nav-image-icon" alt=""/><template v-else>{{item.icon}}</template></span><span>{{item.title}}</span><span v-if="active(item)" class="side-current"></span>
              <span v-if="item.href==='/messages.html'" class="msg-badge hidden" data-message-badge aria-label="未读消息">0</span>
            </a>
          </nav>
          <div class="sidebar-footer">
            <div class="sidebar-footnote"><span class="online-dot" :class="{offline:!online}"></span>{{online?'服务连接正常':'当前处于离线状态'}}</div>
            <div class="sidebar-account"><img class="account-avatar" :src="accountImage(adminArea?user.role:(hasUser?'student':'guest'))" alt="账户头像"><span><b>{{displayName}}</b><small>{{hasUser?(adminArea?'管理员账户':'已登录学生'):'欢迎使用'}}</small></span></div>
          </div>
        </aside>
        <div v-if="showMenu" class="nav-shade" @click="showMenu=false" aria-hidden="true"></div>
        <div class="app-main">
          <header class="app-topbar">
            <div class="topbar-left">
              <button v-if="!isAuth" v-show="isMobile" class="menu-trigger" @click="showMenu=!showMenu" :aria-expanded="showMenu" aria-label="打开功能菜单">☰</button>
              <a v-if="isAuth" class="topbar-home" href="/index.html"><span class="topbar-emblem"><img src="/assets/icons/网页选项卡标题，网站logo.webp" alt=""></span>学分服务中心</a>
              <div v-else class="breadcrumb"><span>服务中心</span><span class="breadcrumb-sep">/</span><b>{{title}}</b></div>
            </div>
            <div class="topbar-right"><button type="button" class="theme-toggle" @click="toggleTheme" :title="themeMode==='dark'?'切换浅色模式':'切换深色模式'" :aria-label="'全局主题切换'"><span class="theme-glyph" aria-hidden="true"></span></button><span class="status-indicator"><span class="online-dot" :class="{offline:!online}"></span>{{online?'在线服务':'网络已断开'}}</span><span class="topbar-identity" v-if="!isAuth">{{displayName}}</span></div>
          </header>
          <div class="app-stage" :class="{'auth-stage':isAuth}">
            <section v-if="isAuth" class="auth-intro">
              <div class="intro-chip"><span class="intro-chip-dot"></span> 学分管理 · 数字校园</div>
              <h1>每一份努力，<br><em>都值得被记录。</em></h1>
              <p>从学分申请到审核反馈，从材料上传到进度查询，一站式连接学生与管理人员。</p>
              <div class="intro-features"><span>✓ 流程清晰</span><span>✓ 实时反馈</span><span>✓ 安全管理</span></div>
              <div class="intro-deco"><span class="deco-sheet d1"></span><span class="deco-sheet d2"></span><span class="deco-check">✓</span></div>
            </section>
            <main class="page-view" id="pageView" @click.capture="showTabLoading" @change.capture="showTabLoading">
              <div v-if="tabLoading" class="credit-tab-loading" role="status">正在加载{{tabLoading}}…</div>
              <section v-if="routePending ? (page !== 'upload' || routeError) : false" class="route-inline-status" :role="routeError?'alert':'status'"><h2>{{titles[page]}}</h2><p>{{routeError || routeStatus}}</p><button v-if="routeError" type="button" class="btn btn-outline" @click="retryRoute">重新检查</button></section>
              <section v-else-if="page==='home'" class="credit-home" :class="adminArea?'credit-home-admin':'credit-home-student'">
                <header class="credit-home-welcome">
                  <div class="credit-home-intro">
                    <p class="credit-home-role">{{adminArea?(user.role==='system'?'系统工作台':'管理员工作台'):'学生服务'}}</p>
                    <h1 :aria-busy="!welcomeReady"><em v-if="welcomeReady">{{welcomeName || displayName}}</em><template v-if="welcomeReady">你好，</template>欢迎使用学分AIC系统</h1>
                    <p>{{adminArea?'在这里进入审核与管理工具，处理日常工作。':'在这里查看学分、提交申请，跟进文件任务和消息。'}}</p>
                  </div>
                  <div class="credit-home-art" aria-hidden="true">
                    <img class="credit-home-flame" :src="adminArea ? '/assets/icons/command-block.gif' : '/assets/icons/soul-fire.gif'" alt="" width="128" height="128">
                  </div>
                  <section class="credit-home-countdowns" aria-label="定时变更" tabindex="0">
                    <span v-if="!homeCountdowns.length" class="credit-home-countdown-empty">{{homeCountdownStatus}}</span>
                    <div v-for="item in homeCountdowns" :key="item.target" class="credit-home-countdown">
                      <span>离{{item.label}}还有</span><strong role="timer">{{item.time}}</strong>
                    </div>
                  </section>
                </header>
                <div class="credit-home-body">
                <section aria-labelledby="credit-home-work">
                  <h2 id="credit-home-work">{{adminArea?'工作队列':'学生任务'}}</h2>
                  <p class="credit-home-work-note">{{adminArea?'进入各工作区处理审核和管理事项。':'从申请到审核反馈，按需选择入口。'}}</p>
                  <div class="credit-home-grid">
                    <a v-for="(item, index) in workCards" :key="item.href" :href="item.href" class="credit-home-card" :class="{'credit-home-review-card':adminArea ? item.href==='/dashboard.html' : false}">
                      <small class="credit-home-card-number" aria-hidden="true">{{String(index+1).padStart(2,'0')}}</small>
                      <img v-if="iconFor(item)" :src="'/assets/icons/'+iconFor(item)" alt="" width="32" height="32">
                      <div>
                        <small v-if="adminArea ? item.href==='/dashboard.html' : false" class="credit-home-review-label">主要工作入口</small>
                        <h3>{{item.title}}</h3><p>{{workDescriptions[item.href]}}</p>
                      </div>
                      <span v-if="adminArea ? item.href==='/dashboard.html' : false" class="credit-home-review-action">进入审核台 <span aria-hidden="true">→</span></span>
                      <span v-else aria-hidden="true">→</span>
                    </a>
                  </div>
                </section>
                <aside v-if="adminArea" class="credit-home-panel">
                  <p class="credit-home-panel-kicker">工作台状态</p>
                  <div class="credit-home-admin-identity">
                    <img :src="accountImage(user.role)" alt="" width="44" height="44">
                    <h2>{{user.role==='system'?'系统管理':'审核与管理'}}</h2>
                  </div>
                  <dl><div><dt>当前账户</dt><dd>{{displayName}}</dd></div><div><dt>网络状态</dt><dd><span class="online-dot" :class="{offline:!online}"></span>{{online?'已连接':'离线'}}</dd></div></dl>
                  <a href="/settings.html?view=admin" class="btn btn-outline">工作台设置</a>
                </aside>
                <aside v-else class="credit-home-panel">
                  <p class="credit-home-panel-kicker">申请指南</p><h2>学分办理三步</h2>
                  <ol><li>准备活动证明</li><li>填写并提交学分申请</li><li>在我的消息查看审核反馈</li></ol>
                  <a :href="hasUser?'/upload.html':'/student-login.html'" class="btn btn-primary">{{hasUser?'开始申请':'学生登录'}}</a>
                </aside>
                </div>
              </section>
              <page-content v-else-if="!routePending" />
            </main>
          </div>
          <footer class="desktop-footer">学分服务中心 <span>·</span> 服务于每一次成长</footer>
        </div>
        <nav v-if="!isAuth" class="mobile-dock" aria-label="移动端快捷导航">
          <a v-for="item in mobileItems" :href="item.href" @click="onNavClick($event,item)" :key="item.href" :class="{'active':active(item)}" :aria-current="active(item)?'page':null"><span class="dock-icon"><img v-if="iconFor(item)" :src="'/assets/icons/'+iconFor(item)" class="nav-image-icon" alt=""/><template v-else>{{item.icon}}</template></span><small>{{item.title}}</small><span v-if="item.href==='/messages.html'" class="msg-badge hidden" data-message-badge aria-label="未读消息">0</span></a>
        </nav>
      </div>`
  });
  if(window.CreditAssignedProof)app.component('credit-assigned-proof', window.CreditAssignedProof);
  app.config.warnHandler = (msg) => { console.warn('[Vue view]', msg); };
  // Paint the shared shell immediately; only the form waits for its service gate.
  app.mount('#app');
})();
