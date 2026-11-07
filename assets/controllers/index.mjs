/** Vue 3 driven 学分总览 page. DOM and events belong to Vue, not innerHTML. */
export function mount(vm) {
  let destroyed = false;
  let requestSerial = 0;
  let unreadTimer = null;
  let searchTimer = null;
  let firstMessages = true;
  const knownMessages = new Set();
  const events = [];
  const unsubscribers = [];
  const register = (target, name, handler) => {target?.addEventListener(name,handler);events.push([target,name,handler]);};
  const user = () => {try { return JSON.parse(localStorage.getItem('studentUser') || 'null'); } catch {return null;}};
  const api = (path, ttl=5000) => window.apiCache?.get(path,{ttl}) || fetch(path).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json()});
  const toast = (message) => {
    vm.indexToasts = [...vm.indexToasts.slice(-2), {id:message.id || Date.now(), title:message.title || '新消息', text:(message.content || '').slice(0,80)}];
    const id = vm.indexToasts.at(-1)?.id;
    setTimeout(()=>{if(!destroyed)vm.indexToasts=vm.indexToasts.filter(m=>m.id!==id)},5200);
  };
  const markUnread = (count) => {
    document.querySelectorAll('[data-message-badge]').forEach(el=>{
      el.textContent=count>99?'99+':String(count);
      el.classList.toggle('hidden',count===0);
    });
  };
  async function checkUnread() {
    if(destroyed||document.hidden)return;
    const account=user();
    if(!localStorage.getItem('studentToken')||!account?.studentId){markUnread(0);return;}
    try{
      const messages=await api('/api/messages?studentId='+encodeURIComponent(account.studentId),0);
      if(!Array.isArray(messages)||destroyed)return;
      const unseen=messages.filter(m=>!m.read);
      markUnread(unseen.length);
      if(!firstMessages) for(const message of unseen) if(!knownMessages.has(message.id))toast(message);
      unseen.forEach(m=>knownMessages.add(m.id));
      if(knownMessages.size>200){const ids=[...knownMessages];knownMessages.clear();ids.slice(-100).forEach(id=>knownMessages.add(id));}
      firstMessages=false;
    }catch(e){/* Unread notification must never prevent the main list. */}
  }
  // Compatibility with earlier cached app.js versions that rendered the tab but
  // omitted its handler. The controller is the page-local authority for this
  // interaction; register it on the live Vue instance before the user clicks.
  vm.indexToggleTab = tab => {
    if (!['pending','needs-fix','assigned'].includes(tab)) return;
    vm.indexTab = tab;
    vm.indexSelectedTaskId = null;
    if (tab === 'assigned' && vm.indexLoggedIn && typeof vm.loadAssignedStudentTasks === 'function') {
      Promise.resolve().then(() => vm.loadAssignedStudentTasks()).catch(err => {
        console.warn('[assigned requests] refresh failed', err);
      });
    }
  };
  const currentUser = () => {vm.indexUser=user();vm.indexLoggedIn=!!(localStorage.getItem('studentToken')&&vm.indexUser);if(vm.loadAssignedStudentTasks)void vm.loadAssignedStudentTasks();};
  async function refresh(force=false){
    const id=++requestSerial;
    vm.indexLoading=true;
    vm.indexError='';
    try {
      if(force){window.apiCache?.invalidate?.('/api/apps');window.apiCache?.invalidate?.('/api/requests?scope=published');}
      const result=await Promise.allSettled([
        api('/api/apps',5000).then(apps=>{if(!destroyed&&id===requestSerial){vm.indexApps=Array.isArray(apps)?apps:[];vm.indexLoading=false;}}),
        api('/api/requests?scope=published',5000).then(published=>{if(!destroyed&&id===requestSerial){vm.indexPublishedTasks=Array.isArray(published)?published:[];vm.indexLoading=false;}})
      ]);
      if(destroyed||id!==requestSerial)return;
      const errors=result.filter(r=>r.status==='rejected');if(errors.length){vm.indexError=errors.length===2?'申请列表加载失败，请重试':'部分申请加载失败，已显示其他申请，请刷新重试';if(force&&errors.length===2)throw Error(vm.indexError);}

    }catch(err){if(!destroyed&&id===requestSerial)vm.indexError=err.message||'加载失败，请重试'; if(force)throw err;}
    finally{if(!destroyed&&id===requestSerial)vm.indexLoading=false;}
  }
  vm.indexRefresh=()=>{window.apiCache?.invalidate('/api/requests');vm.loadAssignedStudentTasks();return refresh(true);};
  vm.indexSearchChanged=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{if(!destroyed)vm.indexSearchReady=vm.indexSearch.trim().toLowerCase()},200)};
  vm.indexLogout=()=>{
    window.showConfirm?.('确认退出','确定要退出登录吗？','退出登录','取消',confirmed=>{
      if(!confirmed)return;
      ['studentToken','studentUser','studentAutoLogin'].forEach(k=>localStorage.removeItem(k));
      window.apiCache?.clear?.(); firstMessages=true;knownMessages.clear();markUnread(0);
  currentUser();vm.indexMenuOpen=false;window.dispatchEvent(new Event('credit-auth-changed'));
      window.flashSuccess?.('已退出登录');
    });
  };
  vm.indexChangePassword=()=>{
    vm.indexMenuOpen=false;
    const ask=(title,help,placeholder)=>new Promise(resolve=>window.showPrompt?.(title,help,'',placeholder,'下一步','取消',resolve));
    (async()=>{
      const oldPwd=await ask('修改密码','请输入当前密码：','当前密码');if(oldPwd===null)return;
      const newPwd=await ask('修改密码','请输入新密码（至少6位）：','新密码');if(newPwd===null)return;
      if(newPwd.length<6){window.flashError?.('新密码至少6位');return;}
      const confirmPwd=await ask('修改密码','请再次输入新密码：','确认新密码');if(confirmPwd===null)return;
      if(newPwd!==confirmPwd){window.flashError?.('两次输入的新密码不一致');return;}
      const account=user();if(!account?.studentId){window.flashError?.('登录信息失效');return;}
      try{
        const r=await fetch('/api/students?action=change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({studentId:account.studentId,oldPassword:oldPwd,newPassword:newPwd})});
        const j=await r.json();if(!r.ok)throw Error(j.error||'修改失败');window.flashSuccess?.('密码修改成功');
      }catch(e){window.flashError?.(e.message||'修改密码失败');}
    })();
  };
  // Register at mount time, not inside the student logout callback.
  const announceToHost = () => {
    if(window.parent===window)return;
    const data={type:'credit-fullscreen-announcement',open:!!vm.indexAnnouncementOpen,
      title:vm.indexAnnouncementTitle,message:vm.indexAnnouncementMessage,
      theme:vm.indexAnnouncementTheme,aero:vm.indexAnnouncementAero,showConfirm:vm.indexAnnouncementShowConfirm};
    // Paint the outer notice in the same task as the iframe view change.
    try{
      if(window.parent.CreditShowFrameAnnouncement?.(window,data))return;
    }catch(_){}
    window.parent.postMessage(data,location.origin);
  };
  register(window,'message',event=>{
    if(event.origin!==location.origin || event.source!==window.parent)return;
    if(event.data?.type==='credit-fullscreen-announcement-close')vm.indexCloseAnnouncement();
    if(event.data?.type==='credit-fullscreen-announcement-sync')announceToHost();
  });
  register(window,'pageshow',event=>{if(destroyed)return;if(event.persisted&&!vm.indexSystemNoticeOpen){vm.indexAnnouncementOpen=false;window.__creditAnnouncementFirstEntry=false;if(window.parent!==window)window.parent.postMessage({type:'credit-announcement-skipped'},location.origin);document.dispatchEvent(new Event('credit-shell-ready'));}announceToHost();});
  currentUser();
  refresh();
  checkUnread();
  unreadTimer=setInterval(checkUnread,12000);
  register(document,'visibilitychange',()=>{if(!document.hidden)checkUnread()});
  register(window,'focus',()=>{checkUnread();void refresh();vm.loadAssignedStudentTasks();});
  register(window,'credit-auth-changed',currentUser);
  register(document,'click',ev=>{if(!ev.target.closest('.user-menu-wrapper'))vm.indexMenuOpen=false});
  if(window.syncBus?.on){
    // syncBus callbacks are light-weight and guard against unmount.
    unsubscribers.push(window.syncBus.on('requests',()=>{window.apiCache?.invalidate('/api/requests');vm.loadAssignedStudentTasks();void refresh(true);}));
    unsubscribers.push(window.syncBus.on('apps',()=>{if(!destroyed)refresh()}));
    unsubscribers.push(window.syncBus.on('messages',()=>{if(!destroyed)checkUnread()}));
  }
  let noticeRequest=0;
  function readyTheme(theme){
    try{
      const preload=window.parent.CreditPreloadAnnouncementTheme||window.CreditPreloadAnnouncementTheme;
      return preload?.(theme) || Promise.resolve('none');
    }catch(_){
      return window.CreditPreloadAnnouncementTheme?.(theme) || Promise.resolve('none');
    }
  }
  register(window,'credit-system-status',async event=>{
    const request=++noticeRequest;
    const state=event.detail;
    if(!state?.systemClosed){
      if(vm.indexSystemNoticeOpen){vm.indexSystemNoticeOpen=false;vm.indexCloseAnnouncement();}
      return;
    }
    const theme=await readyTheme(state.announcementTheme);
    if(destroyed||request!==noticeRequest)return;
    vm.indexSystemNoticeOpen=true;
    vm.entryCountdown='';
    vm.indexAnnouncementTheme=theme;
    vm.indexAnnouncementAero=state.announcementAero===true;
    vm.indexAnnouncementTitle=state.announcementTitle;
    vm.indexAnnouncementMessage=state.announcementMessage;
    vm.indexAnnouncementShowConfirm=false;
    vm.indexAnnouncementOpen=true;
    announceToHost();
  });
  (async()=>{
    let state;
    try { state=await (window.__creditAnnouncementBootstrap || api('/api/settings',0).then(s=>({open:!!(s.announcementEnabled&&String(s.announcementMessage||'').trim()),theme:s.announcementTheme,aero:s.announcementAero===true,title:s.announcementTitle||'系统公告',message:s.announcementMessage||'',showConfirm:s.announcementShowConfirm!==false}))); }
    catch(_) { state={open:false}; }
    if(destroyed)return;
    if(document.documentElement.dataset.announcementState==='ready' && !state?.systemClosed)state={open:false};
    if(state?.open){
      const hold=state.systemClosed?Math.min(1000,Math.max(0,Number(state.systemClosesAt||0)+1000-Date.now())):0;
      const [theme]=await Promise.all([
        readyTheme(state.theme),
        hold ? new Promise(resolve=>setTimeout(resolve,hold)) : Promise.resolve()
      ]);
      if(destroyed)return;
      if(!vm.indexSystemNoticeOpen){
        vm.indexSystemNoticeOpen=!!state.systemClosed;
        vm.indexAnnouncementTheme=theme;
        vm.indexAnnouncementAero=state.aero===true;
        vm.indexAnnouncementTitle=state.title||'系统公告';
        vm.indexAnnouncementMessage=state.message||'';
        vm.indexAnnouncementShowConfirm=state.showConfirm!==false;
        vm.indexAnnouncementOpen=true;
        if(state.systemClosed && window.parent!==window)window.parent.postMessage({type:'credit-system-deadline',closed:true,revision:state.systemShutdownUpdatedAt},location.origin);
      }
    }
    // Wait for Vue to patch the announcement card before revealing the first frame.
    try { await vm.$nextTick?.(); } catch(_) {}
    if(destroyed)return;
    if(window.__creditAnnouncementReveal)window.__creditAnnouncementReveal();else document.documentElement.dataset.announcementState='ready';
    window.dispatchEvent(new Event('credit-announcement-ready'));
    announceToHost();
    if(window.parent!==window)window.parent.postMessage({type:'credit-announcement-ready',open:!!vm.indexAnnouncementOpen},location.origin);
  })();
  return ()=>{destroyed=true;clearInterval(unreadTimer);clearTimeout(searchTimer);unsubscribers.forEach(unsubscribe=>unsubscribe?.());events.forEach(([target,name,fn])=>target.removeEventListener(name,fn));};
}
