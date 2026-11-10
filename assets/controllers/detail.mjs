/** v3.0 Vue application-detail controller.
 * Vue renders all application data, forms, image previews and the blocking modal.
 * This controller performs only IO, file processing and lifecycle cleanup.
 */
export function mount(vm) {
  if (!vm) throw new Error('申请详情需要 Vue 页面实例');
  const token = localStorage.getItem('studentToken');
  let user = {};
  try { user = JSON.parse(localStorage.getItem('studentUser') || '{}') || {}; } catch {}
  let destroyed=false, sending=false, cancelling=false;
  let pendingFiles=[];
  const objectUrls=new Set();
  const stopLeaving = e => {if(!cancelling)return; e.preventDefault();e.returnValue='';};
  const fromDatetimeLocal = text => String(text||'').replace('T',' ');
  const toDatetimeLocal = text => String(text||'').replace(' ','T').slice(0,16);
  const notifyError = text => window.flashError?.(String(text||'操作失败'));
  const wait = ms=>new Promise(r=>setTimeout(r,ms));

  const compress = file => new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('无法读取图片'));
    reader.onload=()=>{
      const img=new Image();
      img.onerror=()=>reject(new Error('图片格式不受支持'));
      img.onload=()=>{
        const MAX=700,scale=Math.min(1,MAX/Math.max(img.width,img.height));
        const canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(img.width*scale));
        canvas.height=Math.max(1,Math.round(img.height*scale));
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        canvas.toBlob(blob=>blob?resolve(new File([blob],file.name,{type:'image/jpeg'})):reject(new Error('图片压缩失败')),'image/jpeg',.5);
      };
      img.src=String(reader.result);
    };
    reader.readAsDataURL(file);
  });

  async function load() {
    const id=new URLSearchParams(location.search).get('id');
    if(!id){vm.detailError='缺少申请编号';vm.detailLoading=false;return;}
    vm.detailLoading=true;vm.detailError='';
    try{
      let assignedApp=null;
      if(id.startsWith('assigned:')){const [,taskId,sid]=id.split(':');const own=token&&String(user.studentId)===sid;const rows=await window.apiCache.get(own?'/api/requests':'/api/requests?scope=published',{ttl:5000,fetchOpts:own?{headers:{Authorization:'Bearer '+token}}:{}});const task=rows.find(t=>t.id===taskId&&String(t.submission?.studentId)===sid);if(!task?.submission)throw Error('申请不存在或无权查看');const sub=task.submission;assignedApp={...sub,id,assigned:true,taskId,versionName:sub.activityName||task.title,packageName:sub.studentId,publisher:String(sub.activityTime||'').replace('T',' '),status:sub.status||'pending',attachmentRequired:task.attachmentRequired,screenshots:[]};assignedApp.screenshots=(sub.files||[]).filter(file=>file.kind?.startsWith('image')).map(file=>({file,taskId,studentId:sid,publicImage:sub.status==='approved'}));}

      const fetchOpts=token?{headers:{Authorization:'Bearer '+token}}:{};
      let apps=assignedApp?[assignedApp]:await window.apiCache?.get('/api/apps',{ttl:5000,fetchOpts});
      let app=Array.isArray(apps) ? apps.find(a=>String(a.id)===id) : null;
      if(!app){
        const res=await fetch('/api/apps/'+encodeURIComponent(id),fetchOpts);
        if(!res.ok)throw new Error(res.status===404?'申请不存在':'无法读取申请详情');
        app=await res.json();
      }
      if(destroyed)return;
      vm.detailApp=app;
      vm.detailCanEdit=app.status==='needs_fix' && !!(token && user.studentId!=null && String(user.studentId)===String(app.packageName));
      vm.detailForm={versionName:String(app.versionName||''),publisher:toDatetimeLocal(app.publisher),participants:String(app.participants||''),location:String(app.location||'')};
      vm.detailImageFailed={};
      document.title=(app.versionName||'申请')+' - 学分申请系统';
    }catch(e){if(!destroyed)vm.detailError=e.message||'加载失败';}
    finally{if(!destroyed)vm.detailLoading=false;}
  }

  const api={
    reload:load,
    goBack(){
      let sameOriginReferrer=false;
      try {
        sameOriginReferrer=!!document.referrer && new URL(document.referrer).origin===location.origin;
      } catch {}
      if(sameOriginReferrer && history.length>1){
        history.back();
        return;
      }
      const routeGuard=window.CreditRouteGuard;
      if(typeof routeGuard?.navigateAway==='function') routeGuard.navigateAway('/index.html',false);
      else location.assign('/index.html');
    },
    imageUrl(file){if(vm.detailApp?.assigned)return file.url;return '/api/screenshots/'+encodeURIComponent(String(vm.detailApp?.id||''))+'/'+String(file);},
    imageFailed(key){vm.detailImageFailed={...vm.detailImageFailed,[key]:true};},
    retryImage(key){vm.detailImageFailed={...vm.detailImageFailed,[key]:false};},
    openImage(src){vm.detailPreviewSrc=String(src||'');},
    closeImage(){vm.detailPreviewSrc='';},
    async downloadAttachment(file){try{const q=new URLSearchParams({action:'download',taskId:vm.detailApp.taskId,studentId:vm.detailApp.packageName,file:file.name});const r=await fetch('/api/requests?'+q,{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error('下载失败，请使用申请人账号登录');const url=URL.createObjectURL(await r.blob());objectUrls.add(url);const a=document.createElement('a');a.href=url;a.download=file.originalName||file.name;a.click();}catch(e){notifyError(e.message)}},
    async pickFiles(event){
      const input=event.target;const files=Array.from(input.files||[]).filter(file=>file.type.startsWith('image/'));
      input.value='';
      if(!files.length || vm.detailEditing || vm.detailCancelling)return;
      if(pendingFiles.length+files.length>2){notifyError('最多上传 2 张新截图');return;}
      try{
        const compressed=await Promise.all(files.map(compress));
        if(destroyed)return;
        pendingFiles.push(...compressed);
        const previews=compressed.map(file=>{
          const url=URL.createObjectURL(file);objectUrls.add(url);
          return {id:crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`,url,name:file.name};
        });
        vm.detailPreviews=[...vm.detailPreviews,...previews];
      }catch(e){notifyError(e.message||'图片处理失败');}
    },
    removePreview(index){
      const preview=vm.detailPreviews[index];
      if(preview?.url){URL.revokeObjectURL(preview.url);objectUrls.delete(preview.url);}
      pendingFiles.splice(index,1);
      vm.detailPreviews=vm.detailPreviews.filter((_,i)=>i!==index);
    },
    async submit(){
      if(sending || cancelling || !vm.detailCanEdit || !vm.detailApp)return;
      const f=vm.detailForm;
      if(!f.versionName?.trim()){notifyError('请填写活动名称');return;}
      sending=true;vm.detailEditing=true;
      const form=new FormData();
      if(vm.detailApp.assigned){form.append('taskId',vm.detailApp.taskId);form.append('activityName',f.versionName.trim());form.append('activityTime',f.publisher);form.append('location',f.location||'');if(vm.detailAssignedAttachment)form.append('attachment',vm.detailAssignedAttachment);}
      form.append('id',vm.detailApp.id);
      form.append('studentId',user.studentId);
      form.append('versionName',f.versionName.trim());
      form.append('publisher',fromDatetimeLocal(f.publisher));
      form.append('participants',String(f.participants||'').trim());
      pendingFiles.forEach(file=>form.append(vm.detailApp.assigned?'images':'screenshots',file));
      try{
        const res=await fetch(vm.detailApp.assigned?'/api/requests':'/api/apps',{method:vm.detailApp.assigned?'POST':'PUT',headers:{Authorization:'Bearer '+token},body:form});
        const payload=await res.json().catch(()=>({}));
        if(!res.ok)throw new Error(payload.error||'提交失败');
        window.apiCache?.invalidatePrefix('/api/apps');if(vm.detailApp?.assigned){window.apiCache?.invalidatePrefix('/api/requests');window.syncBus?.emit('requests',{});}
        window.syncBus?.emit('apps',{action:'update',id:vm.detailApp.id});
        window.flashSuccess?.('修改已提交，等待重新审核');
        if(!destroyed)await wait(700);
        if(!destroyed)window.location.reload();
      }catch(e){notifyError(e.message||'网络异常，请重试');}
      finally{sending=false;if(!destroyed)vm.detailEditing=false;}
    },
    cancel(){
      if(sending || cancelling || !vm.detailCanEdit || !vm.detailApp)return;
      window.showConfirm('确认取消','确定要取消这条申请吗？此操作不可恢复。','确定取消','再想想',async confirmed=>{
        if(!confirmed || sending || cancelling || destroyed)return;
        cancelling=true;vm.detailCancelling=true;
        window.addEventListener('beforeunload',stopLeaving);
        try{
          const res=await fetch(vm.detailApp.assigned?'/api/requests':'/api/apps',{
            method:'DELETE',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
            body:JSON.stringify({id:vm.detailApp.id,taskId:vm.detailApp.taskId,studentId:String(user.studentId)})
          });
          const payload=await res.json().catch(()=>({}));
          if(!res.ok)throw new Error(payload.error||'取消失败，请稍后重试');
          window.apiCache?.invalidatePrefix('/api/apps');if(vm.detailApp?.assigned){window.apiCache?.invalidatePrefix('/api/requests');window.syncBus?.emit('requests',{});}
          window.syncBus?.emit('apps',{action:'delete',id:vm.detailApp.id});
          window.flashSuccess?.('申请已取消');
          window.location.replace('/index.html');
        }catch(e){notifyError(e.message||'网络异常，请重试');}
        finally{
          cancelling=false;
          window.removeEventListener('beforeunload',stopLeaving);
          if(!destroyed)vm.detailCancelling=false;
        }
      });
    }
  };
  const unsubscribe=window.syncBus?.on?.('apps',()=>window.apiCache?.invalidatePrefix('/api/apps'));
  vm.detailApi=api;
  load();
  const keydown=e=>{if(e.key==='Escape' && vm.detailPreviewSrc){vm.detailPreviewSrc='';}};
  window.addEventListener('keydown',keydown);
  return ()=>{
    destroyed=true;
    unsubscribe?.();
    window.removeEventListener('keydown',keydown);
    window.removeEventListener('beforeunload',stopLeaving);
    for(const url of objectUrls)URL.revokeObjectURL(url);
    objectUrls.clear();
  };
}
