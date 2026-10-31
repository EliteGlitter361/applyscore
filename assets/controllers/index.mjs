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
  const currentUser = () => {vm.indexUser=user();vm.indexLoggedIn=!!(localStorage.getItem('studentToken')&&vm.indexUser);};
  async function refresh(force=false){
    const id=++requestSerial;
    vm.indexLoading=true;
    vm.indexError='';
    try {
      if(force)window.apiCache?.invalidate?.('/api/apps');
      const apps=await api('/api/apps',5000);
      if(destroyed||id!==requestSerial)return;
      vm.indexApps=Array.isArray(apps)?apps:[];
    }catch(err){if(!destroyed&&id===requestSerial)vm.indexError=err.message||'加载失败，请重试'; if(force)throw err;}
    finally{if(!destroyed&&id===requestSerial)vm.indexLoading=false;}
  }
  vm.indexRefresh=()=>refresh(true);
  vm.indexSearchChanged=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{if(!destroyed)vm.indexSearchReady=vm.indexSearch.trim().toLowerCase()},200)};
  vm.indexToggleTab=tab=>{if(['pending','needs-fix'].includes(tab))vm.indexTab=tab;};
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
    window.parent.postMessage({type:'credit-fullscreen-announcement',open:!!vm.indexAnnouncementOpen,
      title:vm.indexAnnouncementTitle,message:vm.indexAnnouncementMessage,
      showConfirm:vm.indexAnnouncementShowConfirm},location.origin);
  };
  register(window,'message',event=>{
    if(event.origin!==location.origin || event.source!==window.parent)return;
    if(event.data?.type==='credit-fullscreen-announcement-close')vm.indexCloseAnnouncement();
    if(event.data?.type==='credit-fullscreen-announcement-sync')announceToHost();
  });
  register(window,'pageshow',()=>{if(!destroyed)announceToHost()});
  currentUser();
  refresh();
  checkUnread();
  unreadTimer=setInterval(checkUnread,12000);
  register(document,'visibilitychange',()=>{if(!document.hidden)checkUnread()});
  register(window,'focus',checkUnread);
  register(window,'credit-auth-changed',currentUser);
  register(document,'click',ev=>{if(!ev.target.closest('.user-menu-wrapper'))vm.indexMenuOpen=false});
  if(window.syncBus?.on){
    // syncBus callbacks are light-weight and guard against unmount.
    unsubscribers.push(window.syncBus.on('apps',()=>{if(!destroyed)refresh()}));
    unsubscribers.push(window.syncBus.on('messages',()=>{if(!destroyed)checkUnread()}));
  }
  (async()=>{try{
    const s=await api('/api/settings',60000);
    if(!destroyed && s.announcementEnabled && String(s.announcementMessage || '').trim()) {
      vm.indexAnnouncementTitle=s.announcementTitle||'系统公告';
      vm.indexAnnouncementMessage=s.announcementMessage;
      vm.indexAnnouncementShowConfirm=s.announcementShowConfirm!==false;
      vm.indexAnnouncementOpen=true;
      // The music host is the top-level document: notify it to cover its own UI.
      announceToHost();

    }
  }catch(e){}})();
  return ()=>{destroyed=true;clearInterval(unreadTimer);clearTimeout(searchTimer);unsubscribers.forEach(unsubscribe=>unsubscribe?.());events.forEach(([target,name,fn])=>target.removeEventListener(name,fn));};
}
