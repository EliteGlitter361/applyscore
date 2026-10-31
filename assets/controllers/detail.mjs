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
      let apps=await window.apiCache?.get('/api/apps',{ttl:5000});
      let app=Array.isArray(apps) ? apps.find(a=>String(a.id)===id) : null;
      if(!app){
        const res=await fetch('/api/apps/'+encodeURIComponent(id));
        if(!res.ok)throw new Error(res.status===404?'申请不存在':'无法读取申请详情');
        app=await res.json();
      }
      if(destroyed)return;
      vm.detailApp=app;
      vm.detailCanEdit=app.status==='needs_fix' && !!(token && user.studentId!=null && String(user.studentId)===String(app.packageName));
      vm.detailForm={versionName:String(app.versionName||''),publisher:toDatetimeLocal(app.publisher),participants:String(app.participants||'')};
      vm.detailImageFailed={};
      document.title=(app.versionName||'申请')+' - 学分申请系统';
    }catch(e){if(!destroyed)vm.detailError=e.message||'加载失败';}
    finally{if(!destroyed)vm.detailLoading=false;}
  }

  const api={
    reload:load,
    imageUrl(file){return '/api/screenshots/'+encodeURIComponent(String(vm.detailApp?.id||''))+'/'+String(file);},
    imageFailed(key){vm.detailImageFailed={...vm.detailImageFailed,[key]:true};},
    retryImage(key){vm.detailImageFailed={...vm.detailImageFailed,[key]:false};},
    openImage(src){vm.detailPreviewSrc=String(src||'');},
    closeImage(){vm.detailPreviewSrc='';},
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
      if(!f.publisher){notifyError('请填写活动时间');return;}
      sending=true;vm.detailEditing=true;
      const form=new FormData();
      form.append('id',vm.detailApp.id);
      form.append('studentId',user.studentId);
      form.append('versionName',f.versionName.trim());
      form.append('publisher',fromDatetimeLocal(f.publisher));
      form.append('participants',String(f.participants||'').trim());
      pendingFiles.forEach(file=>form.append('screenshots',file));
      try{
        const res=await fetch('/api/apps',{method:'PUT',body:form});
        const payload=await res.json().catch(()=>({}));
        if(!res.ok)throw new Error(payload.error||'提交失败');
        window.apiCache?.invalidatePrefix('/api/apps');
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
          const res=await fetch('/api/apps',{
            method:'DELETE',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({id:vm.detailApp.id,studentId:String(user.studentId)})
          });
          const payload=await res.json().catch(()=>({}));
          if(!res.ok)throw new Error(payload.error||'取消失败，请稍后重试');
          window.apiCache?.invalidatePrefix('/api/apps');
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
