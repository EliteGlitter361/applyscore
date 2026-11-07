/** v3.1 Vue 3 audit-workbench controller.
 * No HTML string assembly or manual DOM event binding. The Vue view owns
 * lists, selection, dialogs, visibility, feedback and button disabled states.
 * This file only talks to the existing Cloudflare API and cleans up listeners.
 */
export function mount(vm) {
  if (!vm) throw new Error('审核工作台需要 Vue 实例');
  const token = localStorage.getItem('adminToken');
  const authHeader = {Authorization: `Bearer ${token || ''}`};
  const isSystem = vm.isSystem;
  let disposed = false;
  let appsRevision = 0;
  const cleanups=[];
  const notice=(message,failed=false)=>window[failed?'flashError':'flashSuccess']?.(message);
  const apiGet=async(url,ttl,force=false)=> {
    if (window.apiCache?.get) return window.apiCache.get(url,{ttl,force,fetchOpts:{headers:authHeader}});
    const res=await fetch(url,{headers:authHeader});
    if(!res.ok)throw new Error((await res.json().catch(()=>({}))).error || `读取失败 HTTP ${res.status}`);
    return res.json();
  };
  async function loadPermissions(){
    try {
      const data=await apiGet('/api/admin?action=my-permissions',0,true);
      if(disposed)return;
      vm.dashboardCanAssign=isSystem||data.assignedPermission===true||data.assignedPermission===1;
      vm.dashboardCanAudit = data.auditPermission === true || data.auditPermission === 1;
      const stored=JSON.parse(localStorage.getItem('adminUser')||'{}');
      stored.auditPermission=vm.dashboardCanAudit?1:0;
      localStorage.setItem('adminUser',JSON.stringify(stored));
    } catch(err){
      if(!disposed){vm.dashboardCanAssign=false;vm.dashboardCanAudit=false;vm.dashboardCanBan=false;vm.dashboardPermissionError=err.message||'权限读取失败';}
    }
    if(!disposed&&!vm.dashboardCanAssign&&['assigned','compose'].includes(vm.dashboardActiveTab))vm.dashboardActiveTab='pending';
  }
  async function loadApps(force=false){
    const revision=++appsRevision;
    vm.dashboardLoading = vm.dashboardApps.length===0;
    vm.dashboardRefreshing = !!force;
    vm.dashboardError='';
    try {
      const data=await apiGet('/api/apps',5000,force);
      if(disposed||revision!==appsRevision)return;
      if(!Array.isArray(data))throw new Error('申请数据格式错误');
      vm.dashboardApps=data;
      const existing=new Set(data.filter(a=>a.status==='approved').map(a=>String(a.id)));
      vm.dashboardSelected=Object.fromEntries(Object.entries(vm.dashboardSelected).filter(([id,yes])=>yes&&existing.has(id)));
      if(vm.dashboardModalApp && !vm.dashboardModalApp.assigned && !data.some(a=>String(a.id)===String(vm.dashboardModalApp.id)))vm.dashboardModalApp=null;
      else if(vm.dashboardModalApp&&!vm.dashboardModalApp.assigned)vm.dashboardModalApp=data.find(a=>String(a.id)===String(vm.dashboardModalApp.id));
    }catch(err){if(!disposed&&revision===appsRevision){vm.dashboardError=err.message||'申请读取失败';notice(vm.dashboardError,true);}}
    finally{if(!disposed&&revision===appsRevision){vm.dashboardLoading=false;vm.dashboardRefreshing=false;}}
  }
  async function loadAssigned(force=false){
    await loadPermissions();if(disposed||!vm.dashboardCanAssign)return;
    vm.dashboardRefreshing=true;vm.dashboardError='';
    try{const tasks=await apiGet('/api/requests',15000,force);if(disposed)return;vm.dashboardAssigned=tasks.flatMap(t=>(t.submissions||[]).filter(sub=>(sub.status||'pending')==='pending').map(sub=>({...sub,id:t.id+'_'+sub.studentId,taskId:t.id,assigned:true,packageName:sub.studentId,versionName:sub.activityName||t.title,publisher:sub.activityTime,status:sub.status||'pending',taskTitle:t.title})));}
    catch(e){vm.dashboardError=e.message||'指定申请加载失败';}finally{vm.dashboardRefreshing=false;}
  }
  async function request(url,method,body){
    const res=await window.operationFetch(method==='DELETE'?'删除申请':'处理申请',url,{method,headers:{'Content-Type':'application/json',...authHeader},body:JSON.stringify(body)});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||`${method} 请求失败 (HTTP ${res.status})`);
    return data;
  }
  function publish(kind,payload){
    window.apiCache?.invalidate?.('/api/apps');
    window.syncBus?.emit?.(kind,payload);
  }
  async function review(action,reason=''){
    if(disposed||vm.dashboardBusy||!vm.dashboardCanAudit||!vm.dashboardModalApp)return;
    const app=vm.dashboardModalApp;
    if(['needs_fix','reject'].includes(action)&&!reason.trim()){
      vm.dashboardReasonError='请填写原因';return;
    }
    vm.dashboardBusy=true;vm.dashboardActionError='';vm.dashboardReasonError='';
    try{
      if(app.assigned)await request('/api/requests','PATCH',{taskId:app.taskId,studentId:app.studentId,submittedAt:app.submittedAt,status:action==='approve'?'approved':action,reason});
      else await request('/api/audit','PUT',{id:app.id,action,...(['needs_fix','reject'].includes(action)?{rejectReason:reason.trim()}:{})});
      if(disposed)return;
      vm.dashboardModalApp=null;
      vm.dashboardReasonMode='';
      vm.dashboardRejectConfirm=false;
      notice(action==='approve'?'申请已通过':action==='needs_fix'?'已驳回，等待修改':'申请未通过，已删除');
      if(app.assigned){window.apiCache?.invalidate('/api/requests');window.syncBus?.emit('requests',{});await loadAssigned(true);}else{publish('apps',{action,id:app.id});await loadApps(true);}
    }catch(err){if(!disposed){vm.dashboardActionError=err.message||'审核失败';notice(vm.dashboardActionError,true);}}
    finally{if(!disposed)vm.dashboardBusy=false;}
  }
  async function deleteApproved(){
    if(disposed||vm.dashboardBusy)return;
    const ids=vm.dashboardApps.filter(a=>a.status==='approved'&&vm.dashboardSelected[String(a.id)]).map(a=>a.id);
    if(!ids.length){notice('请至少选择一项已审核申请',true);return;}
    vm.dashboardBusy=true;vm.dashboardActionError='';
    try{
      await request('/api/apps','DELETE',{ids});
      if(disposed)return;
      vm.dashboardSelected={};vm.dashboardDeleteConfirm=false;
      notice(`已删除 ${ids.length} 条记录`);
      publish('apps',{action:'delete',ids});
      await loadApps(true);
    }catch(err){if(!disposed){vm.dashboardActionError=err.message||'删除失败';notice(vm.dashboardActionError,true);}}
    finally{if(!disposed)vm.dashboardBusy=false;}
  }
  function onKeydown(e){
    if(e.key!=='Escape'||vm.dashboardBusy)return;
    if(vm.dashboardPreviewSrc){vm.dashboardPreviewSrc='';return;}
    if(vm.dashboardReasonMode){vm.dashboardReasonMode='';vm.dashboardRejectConfirm=false;return;}
    if(vm.dashboardDeleteConfirm){vm.dashboardDeleteConfirm=false;return;}
    vm.dashboardModalApp=null;
  }
  document.addEventListener('keydown',onKeydown);
  cleanups.push(()=>document.removeEventListener('keydown',onKeydown));
  if(window.syncBus?.on){
    cleanups.push(window.syncBus.on('admins',()=>{void loadPermissions();}));
    cleanups.push(window.syncBus.on('requests',()=>{window.apiCache?.invalidate('/api/requests');if(vm.dashboardActiveTab==='assigned')void loadAssigned(true);}));
    cleanups.push(window.syncBus.on('apps',()=>{window.apiCache?.invalidate?.('/api/apps');void loadApps(true);}));
  }
  const permissionTimer=setInterval(()=>{if(!document.hidden)void loadPermissions();},10000);cleanups.push(()=>clearInterval(permissionTimer));
  vm._dashboardApi={loadAssigned,loadApps,review,deleteApproved};
  Promise.all([loadPermissions(),loadApps()]);
  return ()=>{
    disposed=true;appsRevision++;if(vm._assignedPreviewUrl)URL.revokeObjectURL(vm._assignedPreviewUrl);
    cleanups.forEach(fn=>{try{fn?.();}catch{}});
    vm._dashboardApi=null;
  };
}
