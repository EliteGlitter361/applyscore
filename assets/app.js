/** 学分申请系统 · Vue 3 page controllers and rendering (2026). */
(() => {
  'use strict';
  if (window.__routeRedirecting || window.__musicEntering) return; // preflight already redirected, never mount a protected view
  const page = document.documentElement.dataset.page || 'index';
  const titles = {
    index: '学分总览', upload: '提交申请', detail: '申请详情', 'file-upload': '文件上传',
    messages: '我的消息', 'student-login': '学生登录', login: '管理员登录',
    'create-system': '系统初始化', close: '系统通知', dashboard: '审核工作台',
    admin: '系统管理', student: '学生管理', about: '关于', music:'网页音乐盒', settings:'设置'
  };
  const authPages = new Set(['student-login', 'login', 'create-system', 'close']);
  const adminPages = new Set(['dashboard', 'student', 'admin', 'music']);
  const isAuth = authPages.has(page);
  const adminArea = adminPages.has(page) || (['about','settings'].includes(page) && new URLSearchParams(location.search).get('view') === 'admin' && !!localStorage.getItem('adminToken'));
  const navStudent = [
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
    { href: '/dashboard.html', title: '审核工作台', icon: '☷', pages: ['dashboard'] },
    { href: '/student.html', title: '学生管理', icon: '♧', pages: ['student'] },
    { href: '/admin.html', title: '系统管理', icon: '⚙', pages: ['admin'] },
    { href: '/index.html', title: '返回学生端', icon: '↗', pages: ['index'] },
    { href: '/about.html?view=admin', title: '关于', icon: 'ⓘ', pages: ['about'] },
    { href:'/settings.html?view=admin',title:'设置',icon:'⚙',pages:['settings'] },
    { href:'/music.html',title:'网页音乐盒',icon:'▣',pages:['music'] }
  ];
  // Assets are mapped by the user's supplied filenames; no guesswork about image roles.
  const iconFor = item => item.action==='logout-system' ? '退出登录.webp' : ({
    '/index.html':'学分总览.png', '/upload.html':'提交申请.webp',
    '/file-upload.html':'文件上传.webp', '/messages.html':'我的消息.png',
    '/student-login.html':'学生登录.webp', '/login.html':'后台管理.gif',
    '/dashboard.html':'审核台.webp', '/student.html':'学生登录.webp',
    '/admin.html':'系统管理.gif', '/about.html':'关于.png',
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
        dashboardActiveTab:'pending',dashboardCanBan:false,dashboardCanAudit:false,dashboardPermissionError:'',
        dashboardApps:[],dashboardLoading:true,dashboardRefreshing:false,dashboardError:'',dashboardSearch:'',
        dashboardSelected:{},dashboardStudents:[],dashboardStudentsLoading:false,dashboardStudentsError:'',
        dashboardBusy:false,dashboardActionError:'',dashboardModalApp:null,dashboardModalReadOnly:false,
        dashboardImageErrors:{},dashboardPreviewSrc:'',dashboardDeleteConfirm:false,dashboardBanConfirm:null,
        dashboardReasonMode:'',dashboardReasonText:'',dashboardReasonError:'',dashboardRejectConfirm:false,
        indexTab:'pending', indexSearch:'', indexSearchReady:'', indexApps:[], indexLoading:true,
        indexError:'', indexRefreshing:false,indexLoggedIn:false,indexUser:null,indexMenuOpen:false,indexToasts:[],
        indexAnnouncementOpen:false,indexAnnouncementTitle:'系统公告',indexAnnouncementMessage:'',indexAnnouncementShowConfirm:true,
        detailApp:null, detailLoading:true, detailError:'', detailCanEdit:false, detailForm:{versionName:'',publisher:'',participants:''}, detailEditing:false, detailCancelling:false, detailPreviews:[], detailPreviewSrc:'', detailImageFailed:{}, detailApi:{},
        fileRows:[],fileLoading:false,fileError:'',fileActionBusy:false,
        messagesRows:[],messagesLoading:true,messagesError:'',messagesBusy:false,messageDetail:null,
        studentsRows:[],studentsLoading:true,studentsError:'',studentsBusy:false,selectedStudentIds:{},studentNewName:'',studentNewId:'',studentImportVisible:false,studentImportProgress:0,studentImportResult:'',fileUploadSelections:[],
        settingsTheme: window.CreditTheme?.read() || 'light',
        settingsMusic:{enabled:true,showIsland:true,autoPlay:false,mode:'sequence'},
        settingsCacheCount:null,settingsNotice:'',settingsBusy:false,
        settingsReducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false,
        isSystem: adminArea && safeJSON('adminUser').role === 'system',
        closeMessage: new URLSearchParams(window.location.search).get('msg'),
        initialStudentsTab: page === 'admin' && new URLSearchParams(window.location.search).get('tab') === 'students',
        activeTab: page === 'admin' && ['admins','students','messages','tools','files','maintenance','logs','about'].includes(new URLSearchParams(window.location.search).get('tab')) ? new URLSearchParams(window.location.search).get('tab') : 'admins',
        username: '', studentId: '', password: '', confirmPassword: '', autoLogin: true,
        loginError: '', loginPending: false, systemStatus: 'checking', systemStatusError: '', setupSuccess: '',
        adminRows: null, adminListError: '',
        adminStudentsRows:[],adminStudentsLoading:true,adminStudentsError:'',adminStudentSelected:{},
        adminMessageStudents:[],adminMessageStudentsLoading:false,adminMessageStudentsError:'',adminMessageSelected:{},adminMessageResult:'',
        adminLogs:[],adminLogsLoading:false,adminLogsError:'',adminMaintenanceScan:null,
        adminImportFile:null,adminImportBusy:false,adminImportVisible:false,adminImportPercent:0,adminImportDone:0,adminImportTotal:0,adminImportResult:'',adminImportFailures:[],
        adminUploadEnabled:true,adminUploadMultiple:true,adminUploadMaxSubmissions:1,adminUploadFileSizeMode:'20',adminUploadCustomSize:20,
        adminUploadDeadlineMode:'none',adminUploadHours:0,adminUploadMinutes:0,adminUploadSeconds:0,adminUploadDate:'',
        adminUploadSaving:false,adminUploadSaveResult:'',adminUploadSaveError:false,
        fileUploadAllowedMultiple:true,fileUploadMaxMB:20,fileUploadHint:'正在读取上传规则…',fileUploadCountdown:'',fileUploadCountdownUrgent:false,fileUploadExpired:false,
        fileUploadPersonName:'',fileUploadPersonId:'',fileUploadBusy:false,fileUploadModalOpen:false,fileUploadModalProgress:0,fileUploadModalWaiting:false,fileUploadModalFiles:[],
        adminEntryEnabled:true,adminEntryMessage:'',adminEntryResult:'',
        adminRequirementEnabled:false,adminRequirementMessage:'',adminRequirementResult:'',
        adminAnnouncementEnabled:false,adminAnnouncementTitle:'系统公告',adminAnnouncementMessage:'',adminAnnouncementShowConfirm:true,adminAnnouncementResult:'',
        adminSubmissionOpen:false,adminSubmissionReady:false,adminSubmissionTab:'submitted',
        adminSubmissionRows:{submitted:[],notSubmitted:[]},adminExcelExportBusy:false,adminExcelExportResult:'',adminSubmissionStatus:'正在获取提交状态…',adminSubmissionUpdatedAt:0,
        aboutInfo: {title:'',subtitle:'',description:'',organization:'',version:'',contactEmail:'',website:''},
        aboutUpdatedAt: null, aboutStatus: 'loading', aboutError: '', aboutSaving: false, aboutSaveResult: '',
        musicTracks:[],musicSelected:{},musicLoading:false,musicBusy:false,musicError:'',musicPercent:0,musicActionLabel:'', musicDeleteAsk:false, musicDeletePending:[],
        adminProgress: {open:false, busy:false, outcome:'', title:'', detail:'', percent:0, indeterminate:true, scope:''},
        uploadModalOpen: false, uploadModalProgress: 0, uploadModalState: 'uploading', uploadModalError: '',
        applicationName:'',applicationStudentId:'',applicationActivity:'',applicationParticipants:'',applicationLocation:'',applicationTime:'',
        applicationImages:[],applicationProcessingImages:false,applicationSubmitting:false,applicationPreviewSrc:''
      };
    },
    computed:{
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
      selectedMusicCount(){return this.musicTracks.filter(t=>this.musicSelected[t.id]).length},
      selectedStudentsCount(){return this.studentsRows.filter(s=>this.selectedStudentIds[String(s.studentId)]).length},
      studentsAllSelected(){return !!this.studentsRows.length && this.selectedStudentsCount===this.studentsRows.length},
      visibleIndexApps(){
        if(page!=='index')return [];
        const account=this.indexUser;
        const term=this.indexSearchReady;
        return this.indexApps.filter(a=>{
          if(this.indexTab==='pending' && a.status!=='approved')return false;
          if(this.indexTab==='needs-fix' && (a.status!=='needs_fix' || !account || String(a.packageName)!==String(account.studentId)))return false;
          return !term || [a.name,a.packageName,a.versionName].some(value=>String(value||'').toLowerCase().includes(term));
        });
      }
    },
    methods: {
      indexCloseAnnouncement(){this.indexAnnouncementOpen=false;if(window.parent!==window)window.parent.postMessage({type:'credit-fullscreen-announcement',open:false},location.origin);},
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
        if(!['pending','approved','students'].includes(tab))return;
        if(tab==='students'&&(!this.dashboardCanBan||this.isSystem))return;
        this.dashboardActiveTab=tab;this.dashboardSearch='';
      },
      dashboardRefresh(){
        if(this.dashboardBusy||this.dashboardRefreshing)return;
        return this.dashboardActiveTab==='students'?this._dashboardApi?.loadStudents(true):this._dashboardApi?.loadApps(true);
      },
      dashboardOpen(app,readOnly=false){
        if(this.dashboardBusy)return;
        this.dashboardModalApp=app;
        this.dashboardModalReadOnly=!!readOnly;
        this.dashboardImageErrors={};this.dashboardReasonMode='';this.dashboardReasonText='';this.dashboardReasonError='';
        this.dashboardActionError='';this.dashboardRejectConfirm=false;
      },
      dashboardClose(){if(this.dashboardBusy)return;this.dashboardModalApp=null;this.dashboardReasonMode='';this.dashboardRejectConfirm=false;},
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
      dashboardToggleBan(){return this._dashboardApi?.toggleBan(this.dashboardBanConfirm);},
      async refreshIndexClick(button){
        if(this.indexRefreshing)return;
        this.indexRefreshing=true;
        this.indexSearch='';this.indexSearchReady='';
        try{await this.indexRefresh?.();window.flashSuccess?.('已更新学分列表');}
        catch(e){window.flashError?.(e.message||'刷新失败');}
        finally{this.indexRefreshing=false;}
      },
      async loadMusicTracks(){this.musicLoading=true;this.musicError='';try{const res=await fetch('/api/music',{cache:'no-store'});const data=await res.json();if(!res.ok||!Array.isArray(data.tracks))throw Error(data.error||'读取音乐列表失败');this.musicTracks=data.tracks;}catch(e){this.musicError=e.message;}finally{this.musicLoading=false}},
      setMusicSelected(id,checked){this.musicSelected={...this.musicSelected,[id]:!!checked}},
      selectAllMusic(on){this.musicSelected=Object.fromEntries(this.musicTracks.map(t=>[t.id,on]))},
      notifyMusicRefresh(){if(window.parent!==window)window.parent.postMessage({type:'credit-music:refresh'},location.origin);else window.CreditMusicHost?.refresh?.()},
      playMusicTrack(id){if(window.parent!==window && window.parent.CreditMusicHost?.play)window.parent.CreditMusicHost.play(id);else if(window.parent!==window)window.parent.postMessage({type:'credit-music:play',id},location.origin);else window.CreditMusicHost?.play?.(id)},
      async importMusicFiles(ev){const files=Array.from(ev.target.files||[]);ev.target.value='';if(!files.length||this.musicBusy)return;this.musicBusy=true;this.musicError='';this.musicPercent=0;let saved=0;const failed=[];try{for(let i=0;i<files.length;i++){const file=files[i];this.musicActionLabel='正在导入 MP3：'+(i+1)+' / '+files.length;this.musicPercent=Math.floor(i/files.length*100);try{const form=new FormData();form.append('file',file);const res=await fetch('/api/music',{method:'POST',headers:{Authorization:'Bearer '+(localStorage.getItem('aboutWriteToken')||'')},body:form});const data=await res.json();if(!res.ok)throw Error(data.error||'上传失败');saved++;}catch(e){failed.push(file.name+'：'+e.message)}}this.musicPercent=100;await this.loadMusicTracks();this.notifyMusicRefresh();this.musicError=failed.length?'以下文件未导入：'+failed.join('；'):'';if(saved)window.flashSuccess?.('已成功导入 '+saved+' 首 MP3');}finally{this.musicBusy=false}},
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
              const res=await fetch('/api/music/'+encodeURIComponent(id),{method:'DELETE',headers:{Authorization:'Bearer '+(localStorage.getItem('aboutWriteToken')||'')}});
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
      goHome() { window.location.assign('/index.html'); },
      selectApplicationImages(event){return this._applicationApi?.selectImages(event)},
      removeApplicationImage(index){return this._applicationApi?.removeImage(index)},
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
            method:'PUT', headers:{'Content-Type':'application/json', Authorization:'Bearer '+token},
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
        const allowed = ['admins','students','messages','tools','files','maintenance','logs','about'];
        if (!allowed.includes(tab)) return;
        this.activeTab = tab;
        this._tabReady = true;
        if (tab === 'about') this.loadAboutInfo();
        if (page === 'admin') {
          history.replaceState(history.state, '', tab === 'admins' ? '/admin.html' : '/admin.html?tab=' + tab);
          window.__onAdminTabChange?.(tab);
          // Vue-managed management lists: request after the tab becomes active.
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
            if (data?.code === 'GITHUB_CONFIG_MISSING') {
              this.systemStatusError = 'Cloudflare Pages 的环境变量尚未配置完整。请在该 Pages 项目的「设置 → 变量和密钥」中检查 GitHub 配置（生产环境和预览环境分别确认），保存后重新部署。';
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
      if (page === 'about') { await this.loadAboutInfo(); return; }
      if (page === 'music') {await this.loadMusicTracks();return;}
      if (page === 'upload') window.__setUploadProgress = (state, percent, error) => this.updateUploadProgress(state, percent, error);
      if (page === 'detail') this.detailLoading=true;
      
      if (page === 'admin') {
        window.__vueAdminUpdate = data => { this.adminRows = Array.isArray(data) ? data.map(v=>({...v})) : []; this.adminListError=''; };
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
        // Vue owns view lifecycle. Existing API workflows are scoped to one page
        // controller, rather than injected as global, persistent legacy scripts.
        const module = await import('/assets/controllers/' + page + '.mjs?v=3.5.2');
        if (this._isBeingDestroyed || this._isUnmounted) return;
        const cleanup = module.mount(['index','messages','student','file-upload','detail','admin','dashboard','upload'].includes(page) ? this : undefined);
        this._controllerCleanup = typeof cleanup === 'function' ? cleanup : null;
        if (page === 'admin' && this.activeTab === 'about') this.loadAboutInfo();
        if (page === 'admin' && this.activeTab !== 'admins') window.__onAdminTabChange?.(this.activeTab);
        window.__appReady = true;
        document.dispatchEvent(new Event('viewready'));
      } catch(err) { console.error('[Vue page controller]', err); window.flashError?.('页面初始化失败，请刷新重试'); }
    },
    beforeUnmount() { if(page==='settings'){document.removeEventListener('credit-theme-changed',this._settingsThemeHandler);window.removeEventListener('storage',this._settingsMusicHandler);} this._isBeingDestroyed = true; if (page === 'upload') window.__setUploadProgress = null; if (page === 'admin') { window.__vueFileRows=null; window.__vueFileError=null; window.__adminProgressReport = null; window.removeEventListener('beforeunload', this._busyUnloadHandler); window.removeEventListener('keydown', this._busyKeyHandler, true); } this._controllerCleanup?.(); }
  };
  const app = createApp({
    components: { PageContent },
    setup() {
      const isMobile = ref(media.matches);
      const showMenu = ref(false);
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
          return navAdmin.filter(item => !['/student.html', '/index.html'].includes(item.href))
            .concat([{ href: '/login.html', title: '退出登录', icon: '⎋', pages: [], action: 'logout-system' }]);
        }
        // Unchanged admin-account routes and actions.
        return navAdmin.filter(item => !['/admin.html','/music.html'].includes(item.href));
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
        document.addEventListener('credit-theme-changed', syncTheme);
      });
      onBeforeUnmount(() => {
        if (media.removeEventListener) media.removeEventListener('change', updateMobile);
        else media.removeListener(updateMobile);
        window.removeEventListener('resize', updateMobile);
        window.removeEventListener('online', updateOnline);
        window.removeEventListener('offline', updateOnline);
        window.removeEventListener('storage', refreshAccount);
        window.removeEventListener('credit-auth-changed', refreshAccount);
        document.removeEventListener('credit-theme-changed', syncTheme);
      });
      return { page, titles, isAuth, adminArea, isMobile, showMenu, online, hasUser,
        sidebarItems, mobileItems, brandHref, displayName, active, onNavClick, iconFor, accountImage, themeMode, toggleTheme, title: titles[page] || '学分服务', user };
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
              class="side-link" @click="onNavClick($event,item)" :class="{selected:active(item)}" :aria-current="active(item)?'page':null">
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
            <div class="topbar-right"><button v-if="isAuth" type="button" class="theme-toggle" @click="toggleTheme" :title="themeMode==='dark'?'切换浅色模式':'切换深色模式'" :aria-label="themeMode==='dark'?'切换浅色模式':'切换深色模式'"><span class="theme-glyph" aria-hidden="true"></span></button><span class="status-indicator"><span class="online-dot" :class="{offline:!online}"></span>{{online?'在线服务':'网络已断开'}}</span><span class="topbar-identity" v-if="!isAuth">{{displayName}}</span></div>
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
          <a v-for="item in mobileItems" :href="item.href" @click="onNavClick($event,item)" :key="item.href" :class="{'active':active(item)}" :aria-current="active(item)?'page':null"><span class="dock-icon"><img v-if="iconFor(item)" :src="'/assets/icons/'+iconFor(item)" class="nav-image-icon" alt=""/><template v-else>{{item.icon}}</template></span><small>{{item.title}}</small><span v-if="item.href==='/messages.html'" class="msg-badge hidden" data-message-badge aria-label="未读消息">0</span></a>
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
