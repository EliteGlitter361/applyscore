export function mount(vm){let disposed=false;const headers={Authorization:'Bearer '+localStorage.getItem('adminToken')};
 const get=async(url,force=false)=>window.apiCache.get(url,{ttl:url.includes('my-permissions')?0:15000,force,fetchOpts:{headers}});
 async function permissions(){vm.tool.error='';try{const p=await get('/api/admin?action=my-permissions',true);if(disposed)return;vm.tool.permissions=p;const panels=[['compose','assignedPermission'],['messages','messagePermission'],['files','filePermission'],['bans','canBan']];if(!panels.some(([panel,key])=>panel===vm.tool.panel&&p[key])){vm.tool.panel=panels.find(([panel,key])=>p[key])?.[0]||'';vm.requestStudentSelected={};vm.tool.files=[];}if(p.assignedPermission||p.messagePermission)vm.adminStudentsRows=await get('/api/admin-tools?action=students');if(vm.tool.panel==='files')await loadFiles();if(vm.tool.panel==='bans')await loadBans();}catch(e){vm.tool.error=e.message;}finally{vm.tool.loading=false;}}
 async function loadFiles(force=false){vm.tool.busy=true;vm.tool.error='';try{vm.tool.files=await get('/api/admin-tools?action=files',force);}catch(e){vm.tool.error=e.message;}finally{vm.tool.busy=false;}}
 async function refresh(){if(vm.tool.refreshing||vm.tool.busy)return;vm.tool.refreshing=true;try{window.apiCache.invalidatePrefix('/api/admin-tools');await permissions();if(!vm.tool.error)window.flashSuccess?.('管理工具已更新');}finally{vm.tool.refreshing=false;}}
 async function loadBans(force=false){try{vm.tool.banRows=await get('/api/admin-tools?action=ban-students',force);}catch(e){vm.tool.error=e.message;}}
 async function toggleBan(row){if(vm.tool.busy)return;const banned=vm.studentIsBanned(row);
 if(banned&&(!row.canUnban||!await new Promise(resolve=>window.showConfirm('解除封禁','确定解除该学生的封禁？','解封','取消',resolve))))return;
 const ban=banned?null:await window.CreditPromptBan(row.name);
 if(!banned&&!ban)return;if(vm.tool.busy)return;vm.tool.busy=true;try{const r=await window.withOverlay(banned?'正在解封…':'正在封禁…',()=>fetch('/api/students',{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({studentId:row.studentId,banned:!banned,...ban})}),180);const d=await r.json();if(!r.ok)throw Error(d.error);window.apiCache.invalidatePrefix('/api/admin-tools');window.syncBus?.emit('students',{});await loadBans(true);window.flashSuccess?.('学生状态已更新');}catch(e){vm.tool.error=e.message;}finally{vm.tool.busy=false;}}
 async function sendMessages(){if(vm.tool.busy)return;const ids=Object.keys(vm.requestStudentSelected).filter(id=>vm.requestStudentSelected[id]);if(!ids.length){vm.tool.notice='请选择接收学生';return;}window.showConfirm('发送消息','确定向 '+ids.length+' 位学生发送此消息？','发送','取消',async yes=>{if(!yes||vm.tool.busy||disposed)return;vm.tool.busy=true;vm.tool.notice='';try{const r=await window.operationFetch('发送消息','/api/admin-tools?action=messages',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({studentIds:ids,title:vm.tool.messageTitle,content:vm.tool.messageContent})});const d=await r.json();if(!r.ok)throw Error(d.error);vm.tool.notice='已发送给 '+d.sent+' 位学生';vm.tool.messageTitle='';vm.tool.messageContent='';window.apiCache.invalidatePrefix('/api/messages');window.syncBus?.emit('messages',{});}catch(e){vm.tool.notice=e.message+'。如连接中断，请先核实接收情况再重试。';}finally{vm.tool.busy=false;}});}
 async function openFileTask(id){
   vm.fileTaskOpen(id);
   if(vm.fileManageTask!==id)return;
   await vm.$nextTick();
   const dialog=vm.$refs.toolsFileDialog;
   if(dialog&&!dialog.open)dialog.showModal();
 }
 async function refreshFiles(){
   if(vm.tool.busy)return;
   await Promise.all([loadFiles(true),vm.loadFileTasks(true)]);
 }
 async function download(row,file){
   if(vm.tool.downloadKey)return;
   vm.tool.downloadKey=JSON.stringify([row.id,file]);
   try{
     const query=new URLSearchParams({action:'download',id:row.id,file});
     const response=await fetch('/api/admin-tools?'+query,{headers,cache:'no-store',signal:AbortSignal.timeout?.(60000)});
     if(!response.ok){
       const detail=await response.json().catch(()=>({}));
       throw Error(detail.error||'下载失败（HTTP '+response.status+'）');
     }
     const url=URL.createObjectURL(await response.blob());
     const link=document.createElement('a');
     link.href=url;
     link.download=file;
     document.body.appendChild(link);
     try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
   }catch(error){
     window.flashError?.(error.name==='TimeoutError'?'下载超时，请重试':error.message);
   }finally{vm.tool.downloadKey='';}
 }
 const update=e=>{if(e.detail?.url==='/api/admin-tools?action=files')vm.tool.files=e.detail.data;};window.addEventListener('credit-api-updated',update);const unsubscribe=window.syncBus?.on('admins',permissions);const timer=setInterval(()=>{if(!document.hidden)void permissions();},10000);vm.toolApi={refresh,loadBans,toggleBan,loadFiles,openFileTask,refreshFiles,sendMessages,download};permissions();return()=>{disposed=true;clearInterval(timer);unsubscribe?.();window.removeEventListener('credit-api-updated',update);};}
