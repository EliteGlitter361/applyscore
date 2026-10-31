/** 我的消息 · Vue 3 响应式页面控制器。仅负责 API/动作，不直接修改 DOM。 */
export function mount(vm) {
  let active=true;
  const user=(()=>{try{return JSON.parse(localStorage.getItem('studentUser')||'null')}catch{return null}})();
  if(!user?.studentId){vm.messagesLoading=false;vm.messagesError='学生登录信息已失效，请重新登录';return;}
  const url='/api/messages?studentId='+encodeURIComponent(user.studentId);
  function relativeTime(ts){const d=new Date(ts),diff=Date.now()-d.getTime();if(!Number.isFinite(diff))return '时间未知';if(diff<60000)return '刚刚';if(diff<3600000)return Math.floor(diff/60000)+'分钟前';if(diff<86400000)return Math.floor(diff/3600000)+'小时前';if(diff<7*86400000)return Math.floor(diff/86400000)+'天前';return d.toLocaleString('zh-CN');}
  function typeLabel(t){return ({approved:'通过',needs_fix:'驳回修改',rejected:'未通过'})[t]||'系统';}
  function normalise(m){const content=String(m.content||'');const preview=content.replace(/\n/g,' ').slice(0,60);return {...m,id:String(m.id),title:String(m.title||''),content,read:!!m.read,typeClass:['approved','needs_fix','rejected'].includes(m.type)?m.type:'system',typeLabel:typeLabel(m.type),preview:preview+(content.length>60?'…':''),relativeTime:relativeTime(m.createdAt),fullTime:new Date(m.createdAt).toLocaleString('zh-CN')};}
  async function loadMessages(force=true){vm.messagesLoading=true;vm.messagesError='';try{const data=await window.apiCache.get(url,{ttl:0,force});if(!Array.isArray(data))throw Error(data?.error||'消息数据格式错误');if(active){vm.messagesRows=data.map(normalise);if(vm.messageDetail){vm.messageDetail=vm.messagesRows.find(m=>m.id===vm.messageDetail.id)||null;}}}catch(e){if(active)vm.messagesError='消息加载失败：'+(e.message||'请重试');}finally{if(active)vm.messagesLoading=false;}}
  function closeMessageDetail(){vm.messageDetail=null;}
  async function openMessageDetail(id){const msg=vm.messagesRows.find(m=>m.id===String(id));if(!msg)return;vm.messageDetail=msg;if(msg.read)return;msg.read=true;try{const res=await fetch('/api/messages?action=mark-read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messageId:msg.id})});if(!res.ok)throw Error('标记消息失败');window.apiCache?.invalidatePrefix('/api/messages');}catch(e){if(active){msg.read=false;window.flashError?.('已读状态未保存，请稍后重试');}}}
  const confirmDialog=(title,content)=>new Promise(resolve=>window.showConfirm(title,content,'确定','取消',v=>resolve(!!v)));
  async function markAllRead(){if(vm.messagesBusy)return;const n=vm.messagesRows.filter(m=>!m.read).length;if(!n)return;if(!await confirmDialog('确认操作','确定要将所有消息标记为已读吗？'))return;vm.messagesBusy=true;try{const res=await fetch('/api/messages?action=mark-all-read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({studentId:user.studentId})});if(!res.ok){const detail=await res.json().catch(()=>({}));throw Error(detail.error||'标记失败');}if(!active)return;vm.messagesRows=vm.messagesRows.map(m=>({...m,read:true}));if(vm.messageDetail)vm.messageDetail={...vm.messageDetail,read:true};window.apiCache?.invalidatePrefix('/api/messages');window.flashSuccess?.('已全部标记为已读');}catch(e){if(active)window.flashError?.(e.message||'网络错误，请重试');}finally{if(active)vm.messagesBusy=false;}}
  function onKeydown(e){if(e.key==='Escape'&&vm.messageDetail)closeMessageDetail();}
  document.addEventListener('keydown',onKeydown);
  Object.assign(window,{loadMessages,openMessageDetail,closeMessageDetail,markAllRead});
  loadMessages();
  return ()=>{active=false;document.removeEventListener('keydown',onKeydown);for(const key of ['loadMessages','openMessageDetail','closeMessageDetail','markAllRead'])delete window[key];};
}
