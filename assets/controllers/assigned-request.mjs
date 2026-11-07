/** Vue3 student assigned-request independent page controller. */
export function mount(vm) {
  let disposed=false;
  const id=new URLSearchParams(location.search).get('id');
  const publishedStudent=new URLSearchParams(location.search).get('studentId');
  const back=()=>{if(typeof window.CreditRouteGuard?.navigateAway==='function')window.CreditRouteGuard.navigateAway('/index.html?tab=assigned',false);else location.assign('/index.html?tab=assigned');};
  async function reload(){
    if(!id){vm.assignedPageLoading=false;vm.assignedPageError='缺少申请编号';return;}
    const token=localStorage.getItem('studentToken');
    if(!token&&!publishedStudent){const target='/student-login.html?redirect='+encodeURIComponent('/assigned-request.html?id='+encodeURIComponent(id));if(typeof window.CreditRouteGuard?.navigateAway==='function')window.CreditRouteGuard.navigateAway(target,true);else location.replace(target);return;}
    vm.assignedPageLoading=true;vm.assignedPageError='';
    try{
      const res=await fetch(publishedStudent?'/api/requests?scope=published':'/api/requests',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
      const data=await res.json().catch(()=>({}));
      if(!res.ok)throw Error(data.error||'申请读取失败');
      const task=(Array.isArray(data)?data:[]).find(t=>String(t.id)===id&&(!publishedStudent||t.submission?.studentId===publishedStudent));
      if(!task)throw Error('申请不存在，或该申请尚未分配给当前学生');
      if(disposed)return;
      vm.assignedPageTask=task;
      if(task.submission)Object.assign(vm.assignedPageForm,{activityName:task.submission.activityName,participants:task.submission.participants,location:task.submission.location,activityTime:task.submission.activityTime});
      if(task.submitted&&task.submission){
        // Legacy links replace immediately; an entry pageshow must not cancel a delayed redirect.
        const target='/detail.html?id='+encodeURIComponent('assigned:'+task.id+':'+task.submission.studentId);
        location.replace(target);
      }
    }catch(e){if(!disposed)vm.assignedPageError=e.message||'读取失败';}
    finally{if(!disposed)vm.assignedPageLoading=false;}
  }
  async function submit(){
    const t=vm.assignedPageTask, f=vm.assignedPageForm;
    if(!t||(t.submitted&&t.submission?.status!=='needs_fix')||(t.expired&&t.submission?.status!=='needs_fix')||f.busy)return;
    if(!f.activityName.trim()||!f.location.trim()||!f.images.length||(t.attachmentRequired&&!f.attachment)){
      f.error='请填写必填信息并上传活动证明图片'+(t.attachmentRequired?'及附件':'');return;
    }
    f.busy=true;f.error='';
    const body=new FormData();
    body.append('taskId',t.id);body.append('activityName',f.activityName);body.append('participants',f.participants);
    body.append('location',f.location);body.append('activityTime',f.activityTime);
    f.images.forEach(file=>body.append('images',file));if(f.attachment)body.append('attachment',f.attachment);
    try{
      const r=await window.operationFetch('提交指定申请','/api/requests',{method:'POST',headers:{Authorization:'Bearer '+localStorage.getItem('studentToken')},body,cache:'no-store'});
      const data=await r.json().catch(()=>({}));
      if(!r.ok)throw Error(data.error||'提交失败');
      window.flashSuccess?.('申请提交成功');
      window.apiCache?.invalidate('/api/requests');window.syncBus?.emit('requests',{});location.assign('/index.html?tab=assigned');
    }catch(e){f.error=/Failed to fetch|NetworkError|Load failed/i.test(String(e))?'连接中断，提交结果未知，请先返回列表刷新检查，避免重复提交。':(e.message||'提交失败');}
    finally{f.busy=false;}
  }
  vm.assignedPageApi={back,reload,submit};
  reload();
  return ()=>{disposed=true};
}
