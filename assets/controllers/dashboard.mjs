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
  let studentsRevision = 0;
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
      const data=await apiGet('/api/admin?action=my-permissions',60000);
      if(disposed)return;
      vm.dashboardCanAudit = data.auditPermission === true || data.auditPermission === 1;
      vm.dashboardCanBan = !isSystem && data.canBan === true;
      const stored=JSON.parse(localStorage.getItem('adminUser')||'{}');
      stored.auditPermission=vm.dashboardCanAudit?1:0;
      stored.canBan=vm.dashboardCanBan;
      localStorage.setItem('adminUser',JSON.stringify(stored));
    } catch(err){
      if(!disposed){vm.dashboardCanAudit=false;vm.dashboardCanBan=false;vm.dashboardPermissionError=err.message||'权限读取失败';}
    }
    if(!disposed && !vm.dashboardCanBan && vm.dashboardActiveTab==='students')vm.dashboardActiveTab='pending';
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
      if(vm.dashboardModalApp && !data.some(a=>String(a.id)===String(vm.dashboardModalApp.id)))vm.dashboardModalApp=null;
      else if(vm.dashboardModalApp)vm.dashboardModalApp=data.find(a=>String(a.id)===String(vm.dashboardModalApp.id));
    }catch(err){if(!disposed&&revision===appsRevision){vm.dashboardError=err.message||'申请读取失败';notice(vm.dashboardError,true);}}
    finally{if(!disposed&&revision===appsRevision){vm.dashboardLoading=false;vm.dashboardRefreshing=false;}}
  }
  async function loadStudents(force=false){
    if(isSystem||!vm.dashboardCanBan)return;
    const revision=++studentsRevision;
    vm.dashboardStudentsLoading=true;
    vm.dashboardStudentsError='';
    try{
      const data=await apiGet('/api/students',15000,force);
      if(disposed||revision!==studentsRevision)return;
      if(!Array.isArray(data))throw new Error('学生数据格式错误');
      vm.dashboardStudents=data;
    }catch(err){if(!disposed&&revision===studentsRevision)vm.dashboardStudentsError=err.message||'学生名单加载失败';}
    finally{if(!disposed&&revision===studentsRevision)vm.dashboardStudentsLoading=false;}
  }
  async function request(url,method,body){
    const res=await fetch(url,{method,headers:{'Content-Type':'application/json',...authHeader},body:JSON.stringify(body)});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||`${method} 请求失败 (HTTP ${res.status})`);
    return data;
  }
  function publish(kind,payload){
    window.apiCache?.invalidate?.(kind==='students'?'/api/students':'/api/apps');
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
      await request('/api/audit','PUT',{id:app.id,action,...(['needs_fix','reject'].includes(action)?{rejectReason:reason.trim()}:{})});
      if(disposed)return;
      vm.dashboardModalApp=null;
      vm.dashboardReasonMode='';
      vm.dashboardRejectConfirm=false;
      notice(action==='approve'?'申请已通过':action==='needs_fix'?'已驳回，等待修改':'申请未通过，已删除');
      publish('apps',{action,id:app.id});
      await loadApps(true);
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
  async function toggleBan(student){
    if(disposed||vm.dashboardBusy||!vm.dashboardCanBan||isSystem||!student)return;
    const studentId=String(student.studentId);
    vm.dashboardBusy=true;vm.dashboardActionError='';
    try{
      await request('/api/students','PUT',{studentId,banned:!student.banned});
      if(disposed)return;
      vm.dashboardBanConfirm=null;
      notice(student.banned?'已解封学生':'已封禁学生');
      publish('students',{action:'ban',studentId});
      await loadStudents(true);
    }catch(err){if(!disposed){vm.dashboardActionError=err.message||'操作失败';notice(vm.dashboardActionError,true);}}
    finally{if(!disposed)vm.dashboardBusy=false;}
  }
  function onKeydown(e){
    if(e.key!=='Escape'||vm.dashboardBusy)return;
    if(vm.dashboardPreviewSrc){vm.dashboardPreviewSrc='';return;}
    if(vm.dashboardReasonMode){vm.dashboardReasonMode='';vm.dashboardRejectConfirm=false;return;}
    if(vm.dashboardDeleteConfirm){vm.dashboardDeleteConfirm=false;return;}
    if(vm.dashboardBanConfirm){vm.dashboardBanConfirm=null;return;}
    vm.dashboardModalApp=null;
  }
  document.addEventListener('keydown',onKeydown);
  cleanups.push(()=>document.removeEventListener('keydown',onKeydown));
  if(window.syncBus?.on){
    cleanups.push(window.syncBus.on('apps',()=>{window.apiCache?.invalidate?.('/api/apps');void loadApps(true);}));
    cleanups.push(window.syncBus.on('students',()=>{window.apiCache?.invalidate?.('/api/students');void loadStudents(true);}));
  }
  vm._dashboardApi={loadApps,loadStudents,review,deleteApproved,toggleBan};
  Promise.all([loadPermissions(),loadApps()]).then(()=>{
    if(!disposed&&vm.dashboardCanBan)void loadStudents();
  });
  return ()=>{
    disposed=true;appsRevision++;studentsRevision++;
    cleanups.forEach(fn=>{try{fn?.();}catch{}});
    vm._dashboardApi=null;
  };
}
