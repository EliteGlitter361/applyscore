/** Vue 3 page controller — admin.
 * Mounted by the Vue PageContent component; API operations remain unchanged.
 * Business DOM fragments from the pre-Vue project are preserved for compatibility.
 */
export function mount(vm) {

    const token = localStorage.getItem('adminToken');
    const user = JSON.parse(localStorage.getItem('adminUser') || '{}');
    const authHeader = { 'Authorization': `Bearer ${token}` };

    /* 结合边缘缓存后的 TTL */
    const TTL = {
      admins: 30000,
      students: 15000,
      settings: 60000,
      uploads: 0,
      logs: 30000,
      redundant: 60000,
    };

    let adminsData = [];
    let uploadsData = [];
    let students = [];
    let studentsFetchedAt = 0;
    let uploadsFetchedAt = 0;
    let uploadsLoadPromise = null;
    let messageSending = false;
    let zipDownloading = false;
    const reportProgress = (state) => window.__adminProgressReport?.(state);
    let fileAutoRefreshTimer = null;

    function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

    window.__onAdminTabChange = function(tab) {
      if (tab === 'files') { void loadUploads(true).catch(e => console.warn('[file list]', e)); startFileAutoRefresh(); }
      else stopFileAutoRefresh();
      if (tab === 'students') loadStudents();
    };

    function startFileAutoRefresh() {
      stopFileAutoRefresh();
      const indicator = document.getElementById('fileRefreshIndicator');
      if (indicator) indicator.style.display = 'inline-flex';
      fileAutoRefreshTimer = setInterval(() => {
        if (document.getElementById('tab-files').classList.contains('active')) {
          void loadUploads(true).catch(e => console.warn('[files auto refresh]', e));
        }
      }, 10000);  // 10s（边缘缓存吸收）
    }
    function stopFileAutoRefresh() {
      if (fileAutoRefreshTimer) { clearInterval(fileAutoRefreshTimer); fileAutoRefreshTimer = null; }
      const indicator = document.getElementById('fileRefreshIndicator');
      if (indicator) indicator.style.display = 'none';
    }

    /* ===== 管理员管理 ===== */
    function renderAdminTable(admins) {
      // Vue owns the administrator list, including permission toggles and actions.
      window.__vueAdminUpdate?.(admins);
    }

    async function loadAdmins(force = false) {
      try {
        adminsData = await apiCache.get('/api/admin', {
          ttl: TTL.admins, force, fetchOpts: { headers: authHeader }
        });
        renderAdminTable(adminsData);
      } catch (e) {
        window.__vueAdminError?.('加载失败：' + e.message);
      }
    }

    async function togglePerm(btn, username, current) {
      const newVal = !current;
      const admin = adminsData.find(a => a.username === username);
      if (admin) { admin.auditPermission = newVal ? 1 : 0; renderAdminTable(adminsData); }
      try {
        const res = await fetch('/api/admin', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeader },
          body: JSON.stringify({ username, auditPermission: newVal ? 1 : 0 })
        });
        if (!res.ok) throw new Error('更新失败');
        apiCache.invalidate('/api/admin');
        flashSuccess('权限已更新');
        if (window.syncBus) syncBus.emit('admins', { action: 'update', username });
      } catch (e) {
        if (admin) { admin.auditPermission = current ? 1 : 0; renderAdminTable(adminsData); }
        flashError('操作失败');
      }
    }

    async function toggleBanPerm(btn, username, current) {
      const newVal = !current;
      const admin = adminsData.find(a => a.username === username);
      if (admin) { admin.canBan = newVal; renderAdminTable(adminsData); }
      try {
        const res = await fetch('/api/admin', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeader },
          body: JSON.stringify({ username, canBan: newVal })
        });
        if (!res.ok) throw new Error('更新失败');
        apiCache.invalidate('/api/admin');
        flashSuccess('权限已更新');
        if (window.syncBus) syncBus.emit('admins', { action: 'update', username });
      } catch (e) {
        if (admin) { admin.canBan = current; renderAdminTable(adminsData); }
        flashError('操作失败');
      }
    }

    async function createAdmin(btn) {
      const username = document.getElementById('newUsername').value.trim();
      const password = document.getElementById('newPassword').value;
      const role = document.getElementById('newRole').value;
      if (!username || !password) { flashError('请填写完整'); return; }
      if (password.length < 8) { flashError('密码至少8位'); return; }
      await withLoading(btn, async () => {
        try {
          const res = await fetch('/api/admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader },
            body: JSON.stringify({ username, password, role })
          });
          const data = await res.json();
          if (res.ok) {
            flashSuccess('管理员创建成功');
            document.getElementById('newUsername').value = '';
            document.getElementById('newPassword').value = '';
            apiCache.invalidate('/api/admin');
            if (window.syncBus) syncBus.emit('admins', { action: 'create', username });
            loadAdmins(true);
          } else {
            flashError(data.error || '创建失败');
          }
        } catch (e) { flashError('网络错误'); }
        finally {if(vm) vm.fileActionBusy=false;}
      });
    }

    async function deleteAdmin(btn, username) {
      showConfirm('确认删除', `确定要删除管理员"${username}"吗？`, '确定', '取消', async function (confirmed) {
        if (!confirmed) return;
        try {
          const res = await fetch('/api/admin', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', ...authHeader },
            body: JSON.stringify({ username })
          });
          if (res.ok) {
            flashSuccess('已删除');
            apiCache.invalidate('/api/admin');
            if (window.syncBus) syncBus.emit('admins', { action: 'delete', username });
            loadAdmins(true);
          } else {
            const d = await res.json();
            flashError(d.error || '删除失败');
          }
        } catch (e) { flashError('网络错误'); }
      });
    }

    /* ===== 学生管理 ===== */
    async function loadStudents(force = false) {
      vm.adminStudentsLoading = true;
      vm.adminStudentsError = '';
      try {
        students = await apiCache.get('/api/students', {ttl:TTL.students,force,fetchOpts:{headers:authHeader}});
        studentsFetchedAt=Date.now();
        renderStudentTable();
        if(uploadsFetchedAt)updateSubmissionSnapshot(students,uploadsData);
      } catch(e) {vm.adminStudentsError='加载失败：'+e.message;}
      finally{vm.adminStudentsLoading=false;}
    }
    function renderStudentTable(){
      vm.adminStudentsRows = students.map(s=>({...s}));
      const current = new Set(students.map(s=>String(s.studentId)));
      vm.adminStudentSelected=Object.fromEntries(Object.entries(vm.adminStudentSelected).filter(([id,yes])=>yes&&current.has(id)));
    }
    function toggleAllStudents(){vm.adminSelectAllStudents(!vm.adminStudentsAllSelected);}
    function updateStudentSelectedCount(){/* Vue computed adminStudentsSelectedCount */}

    async function addStudent(btn) {
      const name = document.getElementById('newStudentName').value.trim();
      const studentId = document.getElementById('newStudentId').value.trim();
      const password = document.getElementById('newStudentPassword').value.trim();
      if (!name || !studentId) { flashError('请填写姓名和学号'); return; }
      await withLoading(btn, async () => {
        try {
          const res = await fetch('/api/students', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader },
            body: JSON.stringify({ name, studentId, password })
          });
          const data = await res.json();
          if (!res.ok) { flashError(data.error || '添加失败'); return; }
          flashSuccess('学生已添加');
          document.getElementById('newStudentName').value = '';
          document.getElementById('newStudentId').value = '';
          document.getElementById('newStudentPassword').value = '';
          apiCache.invalidate('/api/students');
          if (window.syncBus) syncBus.emit('students', { action: 'create', studentId });
          loadStudents(true);
        } catch (e) { flashError('网络错误'); }
      });
    }

    async function deleteSelectedStudents(btn) {
      const studentIds = vm.adminStudentsRows.filter(s=>vm.adminStudentSelected[String(s.studentId)]).map(s=>String(s.studentId));
      if (!studentIds.length) { flashError('请至少选择一个学生'); return; }
      showConfirm('确认删除', `确定要删除选中的 ${studentIds.length} 名学生吗？`, '确定', '取消', async function (confirmed) {
        if (!confirmed) return;
        await withLoading(btn, async () => {
          try {
            const settled = await Promise.allSettled(studentIds.map(async id => {
              const response=await fetch('/api/students', {method:'DELETE',headers:{'Content-Type':'application/json',...authHeader},body:JSON.stringify({studentId:id})});
              if(!response.ok)throw new Error('删除 '+id+' 失败 (HTTP '+response.status+')');
              return id;
            }));
            const successIds=settled.filter(r=>r.status==='fulfilled').map(r=>r.value);
            const succeeded=new Set(successIds);
            vm.adminStudentSelected=Object.fromEntries(studentIds.filter(id=>!succeeded.has(id)).map(id=>[id,true]));
            if(successIds.length)flashSuccess(`已删除 ${successIds.length} 名学生`);
            if(successIds.length!==studentIds.length)flashError(`${studentIds.length-successIds.length} 名学生删除失败，已保留选中便于重试`);
            apiCache.invalidate('/api/students');
            if(successIds.length)window.syncBus?.emit('students',{action:'delete',studentIds:successIds});
            await loadStudents(true);
          } catch (e) { flashError('网络错误'); }
        });
      });
    }

    async function toggleBanStudent(btn, studentId, currentBanned) {
      showConfirm('确认操作', `确定要${currentBanned ? '解封' : '封禁'}该学生吗？`, '确定', '取消', async function (confirmed) {
        if (!confirmed) return;
        const newVal = !currentBanned;
        try {
          const res = await fetch('/api/students', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...authHeader },
            body: JSON.stringify({ studentId, banned: newVal })
          });
          if (!res.ok) { const err = await res.json(); flashError(err.error || '操作失败'); return; }
          /* Vue will update the affected row on refresh. */
          flashSuccess(newVal ? '已封禁' : '已解封');
          apiCache.invalidate('/api/students');
          if (window.syncBus) syncBus.emit('students', { action: 'ban', studentId });
          loadStudents(true);
        } catch (e) { flashError('网络错误'); }
      });
    }

    async function resetStudentPassword(btn, studentId, currentPwd) {
      showPrompt('重置密码', `为学生 ${studentId} 设置新密码：`, currentPwd, '新密码', '确定', '取消', async function (newPwd) {
        if (newPwd === null) return;
        try {
          const res = await fetch('/api/students', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...authHeader },
            body: JSON.stringify({ studentId, password: newPwd })
          });
          if (!res.ok) { const d = await res.json(); flashError(d.error || '失败'); return; }
          flashSuccess('密码已重置');
          apiCache.invalidate('/api/students');
          loadStudents(true);
        } catch (e) { flashError('网络错误'); }
      });
    }

    /** Vue-managed spreadsheet import; serial writes preserve Gitee SHA consistency. */
    async function importStudents(btn) {
      if (vm.adminImportBusy) return;
      const file = vm.adminImportFile;
      if (!file) { flashError('请选择 Excel 文件'); return; }
      if (!/\.xlsx?$/i.test(file.name)) { flashError('只支持 xls / xlsx 文件'); return; }
      vm.adminImportBusy=true;vm.adminImportVisible=true;vm.adminImportPercent=0;
      vm.adminImportDone=0;vm.adminImportTotal=0;vm.adminImportFailures=[];vm.adminImportResult='正在解析文件…';
      try {
        if (!window.XLSX) throw new Error('Excel 组件尚未加载');
        const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), {type:'array'});
        if (!workbook.SheetNames?.length) throw new Error('Excel 文件内没有工作表');
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        // Text representation preserves formatted student numbers when cell formats exist.
        const rows = XLSX.utils.sheet_to_json(sheet, {defval:'',raw:false});
        const headers=Object.keys(rows[0]||{});
        const nameKey=headers.find(h=>/姓名|name/i.test(h));
        const idKey=headers.find(h=>/学号|student\s*id/i.test(h));
        const pwdKey=headers.find(h=>/密码|password/i.test(h));
        if(!nameKey||!idKey)throw new Error('未找到“姓名”和“学号”列');
        const studentsToAdd=rows.map((r,i)=>({row:i+2,name:String(r[nameKey]??'').trim(),studentId:String(r[idKey]??'').trim(),password:pwdKey?String(r[pwdKey]??'').trim():''})).filter(s=>s.name&&s.studentId);
        if(!studentsToAdd.length)throw new Error('没有有效数据');
        vm.adminImportTotal=studentsToAdd.length;
        vm.adminImportResult=`共 ${studentsToAdd.length} 条，正在逐项导入…`;
        let success=0;
        for(let i=0;i<studentsToAdd.length;i++){
          const row=studentsToAdd[i];
          try{
            const response=await fetch('/api/students',{method:'POST',headers:{'Content-Type':'application/json',...authHeader},body:JSON.stringify({name:row.name,studentId:row.studentId,password:row.password})});
            if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.error||`HTTP ${response.status}`);}
            success++;
          }catch(error){vm.adminImportFailures.push(`第 ${row.row} 行（${row.studentId}）：${error.message||'网络错误'}`);}
          vm.adminImportDone=i+1;
          vm.adminImportPercent=Math.round((i+1)/studentsToAdd.length*100);
        }
        vm.adminImportResult=`导入完成：成功 ${success} 条，失败 ${vm.adminImportFailures.length} 条`;
        apiCache.invalidate('/api/students');window.syncBus?.emit('students',{action:'import'});await loadStudents(true);
        if(!vm.adminImportFailures.length)flashSuccess(`成功导入 ${success} 条`);
        else flashError(`成功 ${success} 条，失败 ${vm.adminImportFailures.length} 条；可展开查看明细`);
      }catch(error){vm.adminImportResult='导入失败：'+(error.message||'无法解析文件');flashError(vm.adminImportResult);}
      finally{vm.adminImportBusy=false;}
    }

    /* ===== 消息发送 · Vue 3 reactive recipients ===== */
    async function loadMsgStudentList(){
      vm.adminMessageStudentsLoading=true;vm.adminMessageStudentsError='';
      try{
        const rows=await apiCache.get('/api/students',{ttl:TTL.students,fetchOpts:{headers:authHeader}});
        vm.adminMessageStudents=Array.isArray(rows)?rows.map(s=>({...s})):[];
        const valid=new Set(vm.adminMessageStudents.map(s=>String(s.studentId)));
        vm.adminMessageSelected=Object.fromEntries(Object.entries(vm.adminMessageSelected).filter(([id,yes])=>yes&&valid.has(id)));
      }catch(e){vm.adminMessageStudentsError='加载失败：'+e.message;}
      finally{vm.adminMessageStudentsLoading=false;}
    }
    function toggleMsgStudent(checkbox){vm.adminToggleMessageStudent(checkbox.value,checkbox.checked);}
    function selectAllMsgStudents(){vm.adminSelectAllMessageStudents(true);}
    function clearAllMsgStudents(){vm.adminSelectAllMessageStudents(false);}
    function updateMsgSelectedCount(){/* Vue computed */}
    async function sendCustomMessage(btn){
      if(messageSending||zipDownloading||vm.adminProgress.busy)return;
      const title=document.getElementById('msgTitle').value.trim();
      const content=document.getElementById('msgContent').value.trim();
      const recipients=vm.adminMessageStudents.filter(s=>vm.adminMessageSelected[String(s.studentId)]).map(s=>String(s.studentId));
      if(!title){flashError('请填写消息标题');return;}
      if(!content){flashError('请填写消息内容');return;}
      if(!recipients.length){flashError('请至少选择一个学生');return;}
      showConfirm('确认发送',`确定向选中的 ${recipients.length} 名学生发送消息吗？`,'确定发送','取消',async confirmed=>{
        if(!confirmed||messageSending)return;
        messageSending=true;btn.disabled=true;
        let success=0,fail=0;const failedIds=[];vm.adminMessageResult='';
        reportProgress({type:'start',title:'正在发送消息…',detail:`准备发送给 ${recipients.length} 名学生`,indeterminate:false});
        try{
          // Preserve sequential Gitee writes to avoid SHA conflicts.
          for(let i=0;i<recipients.length;i++){
            const studentId=recipients[i];
            try{
              const res=await fetch('/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({studentId,title,content,type:'system'})});
              if(res.ok)success++;else{fail++;failedIds.push(studentId);}
            }catch{fail++;failedIds.push(studentId);}
            reportProgress({type:'update',percent:Math.round((i+1)/recipients.length*100),detail:`已处理 ${i+1}/${recipients.length} 人 · 成功 ${success} · 失败 ${fail}`});
          }
          vm.adminMessageResult=`发送完成：成功 ${success} 条，失败 ${fail} 条`;
          if(success){window.syncBus?.emit('messages',{action:'send'});}
          if(fail){vm.adminMessageSelected=Object.fromEntries(failedIds.map(id=>[id,true]));}
          else{vm.adminMessageSelected={};document.getElementById('msgTitle').value='';document.getElementById('msgContent').value='';}
          reportProgress({type:fail?'error':'success',title:fail?'消息发送部分失败':'消息发送完成',detail:`成功 ${success} 条，失败 ${fail} 条${fail?'。失败学生已保留勾选，可重试。':'。全部接收人已处理。'}`});
        }catch(e){reportProgress({type:'error',title:'消息发送失败',detail:e.message||'网络请求异常，请检查消息状态'});}
        finally{messageSending=false;btn.disabled=false;}
      });
    }

    /* ===== 系统维护 ===== */
    async function scanRedundantData(btn){
      await withLoading(btn,async()=>{
        try{
          const data=await apiCache.get('/api/maintenance?action=scan',{ttl:0,force:true,fetchOpts:{headers:authHeader}});
          if(!Array.isArray(data.apps))data.apps=[];
          vm.adminMaintenanceScan={...data};
          flashSuccess(`扫描完成，发现 ${data.count||0} 条冗余数据`);
        }catch(e){flashError('扫描失败：'+e.message);}
      });
    }

    async function cleanRedundantData(btn) {
      showConfirm('危险操作', '确定要清理所有冗余数据吗？此操作不可恢复！', '确定清理', '取消', function (confirmed) {
        if (!confirmed) return;
        showConfirm('二次确认', '请再次确认：清空所有冗余数据？', '确定清理', '取消', async function (confirmed2) {
          if (!confirmed2) return;
          await withLoading(btn, async () => {
            try {
              const res = await fetch('/api/maintenance?action=clean', { method: 'POST', headers: authHeader });
              const data = await res.json();
              if (res.ok) {
                flashSuccess(data.message || '清理完成');
                apiCache.invalidatePrefix('/api/');
                vm.adminMaintenanceScan=null;
                await scanRedundantData(btn);
              } else {
                flashError(data.error || '清理失败');
              }
            } catch (e) { flashError('网络错误'); }
          });
        });
      });
    }

    /* ===== 修改密码 ===== */
    async function changePassword(btn) {
      const username = document.getElementById('changePwdUsername').value.trim();
      const newPassword = document.getElementById('changePwdNewPwd').value;
      if (!username || !newPassword) { flashError('请填写完整'); return; }
      if (newPassword.length < 8) { flashError('新密码至少8位'); return; }
      showConfirm('确认修改', `确定要修改用户"${username}"的密码吗？`, '确定', '取消', async function (confirmed) {
        if (!confirmed) return;
        await withLoading(btn, async () => {
          try {
            const res = await fetch('/api/admin?action=change-password', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...authHeader },
              body: JSON.stringify({ username, newPassword })
            });
            const data = await res.json();
            if (res.ok) {
              flashSuccess('密码修改成功');
              document.getElementById('changePwdUsername').value = '';
              document.getElementById('changePwdNewPwd').value = '';
            } else {
              flashError(data.error || '修改失败');
            }
          } catch (e) { flashError('网络错误'); }
        });
      });
    }

    /* ===== 清空数据 ===== */
    async function clearData(btn) {
      showConfirm('危险操作', '确定要清空所有申请数据和学生数据吗？此操作不可恢复！', '确定清空', '取消', function (confirmed) {
        if (!confirmed) return;
        showConfirm('二次确认', '请再次确认：清空所有数据？', '确定清空', '取消', async function (confirmed2) {
          if (!confirmed2) return;
          await withLoading(btn, async () => {
            try {
              const res = await fetch('/api/admin?action=clear-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeader },
                body: JSON.stringify({ confirm: 'yes' })
              });
              const data = await res.json();
              if (res.ok) {
                flashSuccess('系统数据已清空');
                apiCache.clear();
                if (window.syncBus) syncBus.emit('apps', { action: 'clear' });
                if (window.syncBus) syncBus.emit('students', { action: 'clear' });
              } else {
                flashError(data.error || '清空失败');
              }
            } catch (e) { flashError('网络错误'); }
          });
        });
      });
    }

    /* ===== 日志 ===== */
    async function loadLogs(force=false){
      vm.adminLogsLoading=true;vm.adminLogsError='';
      try{
        const rows=await apiCache.get('/api/admin?action=login-logs',{ttl:TTL.logs,force,fetchOpts:{headers:authHeader}});
        vm.adminLogs=Array.isArray(rows)?rows.map(row=>({...row})):[];
      }catch(e){vm.adminLogsError='加载失败：'+e.message;if(force)throw e;}
      finally{vm.adminLogsLoading=false;}
    }

    /* ===== 设置 ===== */
    let entrySettings = { enabled: true, message: '' };
    let fileUploadSettings = { fileUploadEnabled: true, allowMultipleFiles: true, fileUploadDeadline: null, fileUploadDeadlineEnabled: false, maxSubmissionsPerStudent: 1, maxFileSizeMB: 20 };
    let requirementSettings = { uploadRequirementEnabled: false, uploadRequirementMessage: '' };
    let announcementSettings = { announcementEnabled: false, announcementTitle: '系统公告', announcementMessage: '' };

    async function loadEntrySettings() {
      try {
        const all = await apiCache.get('/api/settings', {
          ttl: TTL.settings, fetchOpts: { headers: authHeader }
        });
        entrySettings = { enabled: all.enabled !== false, message: all.message || '' };
        fileUploadSettings = {
          fileUploadEnabled: all.fileUploadEnabled !== false,
          allowMultipleFiles: all.allowMultipleFiles !== false,
          fileUploadDeadline: all.fileUploadDeadline || null,
          fileUploadDeadlineEnabled: all.fileUploadDeadlineEnabled || false,
          maxSubmissionsPerStudent: all.maxSubmissionsPerStudent || 1,
          maxFileSizeMB: all.maxFileSizeMB || 20,
        };
        requirementSettings = {
          uploadRequirementEnabled: all.uploadRequirementEnabled || false,
          uploadRequirementMessage: all.uploadRequirementMessage || '',
        };
        announcementSettings = {
          announcementEnabled: all.announcementEnabled || false,
          announcementTitle: all.announcementTitle || '系统公告',
          announcementMessage: all.announcementMessage || '',
        };
        updateEntryUI();
        updateFileUploadUI();
        updateRequirementUI();
        updateAnnouncementUI();
      } catch (e) { console.error(e); }
    }

    function updateEntryUI() {
      vm.adminEntryEnabled=!!entrySettings.enabled;
      vm.adminEntryMessage=entrySettings.message||'';
    }
    function toggleEntry(){vm.adminEntryEnabled=!vm.adminEntryEnabled;}

    async function saveEntrySettings(btn){
      await withLoading(btn,async()=>{
        vm.adminEntryResult='保存中…';
        try{
          const payload={enabled:vm.adminEntryEnabled,message:vm.adminEntryMessage.trim()};
          const res=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json',...authHeader},body:JSON.stringify(payload)});
          const data=await res.json().catch(()=>({}));
          if(!res.ok)throw new Error(data.error||'保存失败');
          entrySettings={...payload};vm.adminEntryResult='保存成功';
          apiCache.invalidate('/api/settings');window.syncBus?.emit('settings',{action:'update'});flashSuccess('设置已保存');
        }catch(e){vm.adminEntryResult=e.message||'网络错误';flashError(vm.adminEntryResult);}
      });
    }

    /** Upload settings are now owned by Vue; controller only maps API data. */
    function updateFileUploadUI(){
      vm.adminUploadEnabled=fileUploadSettings.fileUploadEnabled!==false;
      vm.adminUploadMultiple=fileUploadSettings.allowMultipleFiles!==false;
      vm.adminUploadMaxSubmissions=Number(fileUploadSettings.maxSubmissionsPerStudent)||1;
      const maxMB=Number(fileUploadSettings.maxFileSizeMB)||20;
      vm.adminUploadFileSizeMode=[20,50,100].includes(maxMB)?String(maxMB):'custom';
      vm.adminUploadCustomSize=maxMB;
      const deadline=Number(fileUploadSettings.fileUploadDeadline);
      const valid=fileUploadSettings.fileUploadDeadlineEnabled && Number.isFinite(deadline) && deadline>0;
      vm.adminUploadDeadlineMode=valid?'date':'none';
      if(valid){const d=new Date(deadline);const pad=n=>String(n).padStart(2,'0');vm.adminUploadDate=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;}
      vm.adminUploadHours=0;vm.adminUploadMinutes=0;vm.adminUploadSeconds=0;
    }
    function toggleFileUpload(){vm.adminUploadEnabled=!vm.adminUploadEnabled;}
    function toggleMultiple(){vm.adminUploadMultiple=!vm.adminUploadMultiple;}
    // Compatibility for code that still invokes the legacy action names.
    function updateFileSizePreview(){return vm.adminUploadFileSizePreview;}
    function updateDeadlinePreview(){return vm.adminUploadDeadlinePreview;}
    async function saveFileUploadSettings(btn){
      if(vm.adminUploadSaving)return;
      vm.adminUploadSaveResult='';vm.adminUploadSaveError=false;
      const maxSub=Number(vm.adminUploadMaxSubmissions);
      if(!Number.isSafeInteger(maxSub)||maxSub<1){flashError('最大提交次数必须是大于 0 的整数');return;}
      const maxMB=Number(vm.adminUploadFileSizeMode==='custom'?vm.adminUploadCustomSize:vm.adminUploadFileSizeMode);
      if(!Number.isSafeInteger(maxMB)||maxMB<1){flashError('文件大小至少为 1MB，且必须为整数');return;}
      let deadlineTimestamp=null,deadlineEnabled=false;
      if(vm.adminUploadDeadlineMode==='duration'){
        const h=Number(vm.adminUploadHours),m=Number(vm.adminUploadMinutes),sec=Number(vm.adminUploadSeconds);
        if(![h,m,sec].every(n=>Number.isSafeInteger(n)&&n>=0)||m>59||sec>59){flashError('时长请输入有效的时、分、秒');return;}
        const ms=(h*3600+m*60+sec)*1000;
        if(!Number.isFinite(ms)||ms<=0){flashError('请输入有效的时长');return;}
        deadlineTimestamp=Date.now()+ms;deadlineEnabled=true;
      }else if(vm.adminUploadDeadlineMode==='date'){
        if(!vm.adminUploadDate){flashError('请选择日期时间');return;}
        deadlineTimestamp=new Date(vm.adminUploadDate).getTime();
        if(!Number.isFinite(deadlineTimestamp)||deadlineTimestamp<=Date.now()){flashError('截止时间必须晚于当前时间');return;}
        deadlineEnabled=true;
      }
      const payload={fileUploadEnabled:vm.adminUploadEnabled,allowMultipleFiles:vm.adminUploadMultiple,fileUploadDeadline:deadlineTimestamp,fileUploadDeadlineEnabled:deadlineEnabled,maxSubmissionsPerStudent:maxSub,maxFileSizeMB:maxMB};
      vm.adminUploadSaving=true;vm.adminUploadSaveResult='保存中…';
      try{
        const response=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json',...authHeader},body:JSON.stringify(payload)});
        const data=await response.json().catch(()=>({}));
        if(!response.ok)throw Error(data.error||'保存失败');
        fileUploadSettings={...fileUploadSettings,...payload};
        vm.adminUploadSaveResult='保存成功';
        apiCache.invalidate('/api/settings');window.syncBus?.emit('settings',{action:'update'});flashSuccess('文件上传设置已保存');
      }catch(error){vm.adminUploadSaveError=true;vm.adminUploadSaveResult=error.message||'网络错误';flashError(vm.adminUploadSaveResult);}
      finally{vm.adminUploadSaving=false;}
    }

    function updateRequirementUI(){
      vm.adminRequirementEnabled=!!requirementSettings.uploadRequirementEnabled;
      vm.adminRequirementMessage=requirementSettings.uploadRequirementMessage||'';
    }
    function toggleRequirement(){vm.adminRequirementEnabled=!vm.adminRequirementEnabled;}

    async function saveRequirementSettings(btn){
      await withLoading(btn,async()=>{
        vm.adminRequirementResult='保存中…';
        try{
          const payload={uploadRequirementEnabled:vm.adminRequirementEnabled,uploadRequirementMessage:vm.adminRequirementMessage.trim()};
          const res=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json',...authHeader},body:JSON.stringify(payload)});
          const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||'保存失败');
          requirementSettings={...payload};vm.adminRequirementResult='保存成功';
          apiCache.invalidate('/api/settings');window.syncBus?.emit('settings',{action:'update'});flashSuccess('弹窗设置已保存');
        }catch(e){vm.adminRequirementResult=e.message||'网络错误';flashError(vm.adminRequirementResult);}
      });
    }

    function updateAnnouncementUI(){
      vm.adminAnnouncementEnabled=!!announcementSettings.announcementEnabled;
      vm.adminAnnouncementTitle=announcementSettings.announcementTitle||'系统公告';
      vm.adminAnnouncementMessage=announcementSettings.announcementMessage||'';
    }
    function toggleAnnouncement(){vm.adminAnnouncementEnabled=!vm.adminAnnouncementEnabled;}

    async function saveAnnouncementSettings(btn){
      await withLoading(btn,async()=>{
        vm.adminAnnouncementResult='保存中…';
        try{
          const payload={announcementEnabled:vm.adminAnnouncementEnabled,announcementTitle:vm.adminAnnouncementTitle.trim()||'系统公告',announcementMessage:vm.adminAnnouncementMessage.trim()};
          const res=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json',...authHeader},body:JSON.stringify(payload)});
          const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||'保存失败');
          announcementSettings={...payload};vm.adminAnnouncementResult='保存成功';
          apiCache.invalidate('/api/settings');window.syncBus?.emit('settings',{action:'update'});flashSuccess('公告已保存');
        }catch(e){vm.adminAnnouncementResult=e.message||'网络错误';flashError(vm.adminAnnouncementResult);}
      });
    }

    /* ===== 文件管理 ===== */
    async function loadUploads(force = false) {
      if(vm && vm.fileRows.length===0)vm.fileLoading=true;
      if (uploadsLoadPromise) return uploadsLoadPromise;
      uploadsLoadPromise = (async () => {
        try {
          uploadsData = await apiCache.get('/api/files', {
            ttl: 8000, force, fetchOpts: { headers: authHeader }
          });
          uploadsFetchedAt = Date.now();
          renderUploads();
          if (studentsFetchedAt) updateSubmissionSnapshot(students, uploadsData);
        } catch (e) {
          if (vm) { vm.fileError=e.message||'读取失败'; vm.fileLoading=false; } else window.__vueFileError?.(e.message);
          if (force) throw e;
        }
      })().finally(() => { uploadsLoadPromise = null; });
      return uploadsLoadPromise;
    }

    // Historical uploads.json entries can contain names that are already URI-
    // encoded (e.g. "1_%E6%8A%A5%E5%91%8A.docx"). The original pre-Vue
    // downloader sent those values directly as URL path components; running
    // encodeURIComponent on them again produces %25E6... and breaks Gitee.
    // Normalize the *stored representation* exactly once before encoding a
    // browser URL. This works for both older encoded records and newer plain
    // Chinese names. Never decode URL segments again in the browser.
    function normalizeUploadFileName(stored) {
      const raw = String(stored ?? '');
      try {
        const decoded = decodeURIComponent(raw);
        // Disallow path separators; the API route also validates them.
        if (decoded && !/[\\/\x00-\x1f]/.test(decoded) && decoded !== '.' && decoded !== '..')
          return decoded;
      } catch (_) { /* legacy plain names containing a literal % */ }
      return raw;
    }

    function uploadDownloadUrl(id, stored) {
      return `/api/uploads/${encodeURIComponent(String(id))}/${encodeURIComponent(normalizeUploadFileName(stored))}`;
    }

    function renderUploads() {
      // Vue owns the entire files table. Do not rebuild <tbody> or attach inline click handlers.
      const rows=[];
      uploadsData.forEach(u=>(u.files||[]).forEach(f=>rows.push({
        id:String(u.id), name:u.name, studentId:u.studentId,
        fileName:f, displayName:normalizeUploadFileName(f),
        url:uploadDownloadUrl(u.id,f),
        displayTime:u.uploadedAt ? new Date(u.uploadedAt).toLocaleString('zh-CN') : ''
      })));
      if(vm){vm.fileRows=rows;vm.fileError='';vm.fileLoading=false;}
      else window.__vueFileRows?.(rows);
    }

    async function deleteUpload(btn, id) {
      if (vm?.fileActionBusy) return;
      showConfirm('确认删除', '删除该上传记录后，该学生可以重新提交。确定要删除吗？', '确定', '取消', async function (confirmed) {
        if (!confirmed) return;
        if(vm)vm.fileActionBusy=true;
        try {
          const res = await fetch('/api/files', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', ...authHeader },
            body: JSON.stringify({ ids: [id] })
          });
          if (res.ok) {
            flashSuccess('记录已删除');
            apiCache.invalidate('/api/files');
            if (window.syncBus) syncBus.emit('files', { action: 'delete', id });
            loadUploads(true);
          } else {
            const d = await res.json();
            flashError(d.error || '删除失败');
          }
        } catch (e) { flashError('网络错误'); }
      });
    }

    /* ===== 文件管理 · 全新原生 ZIP 下载（无需 JSZip） =====
     * 下载、校验、组装三个阶段完全独立。每个请求都有确定的结算结果，
     * 不允许一个停滞的 fetch()/reader.read() 阻塞全部文件。
     * ZIP 使用 STORE（无重复压缩）、UTF-8 文件名和标准 ZIP32 目录结构。
     * Blob 以文件块为部件拼接，不额外复制整包到巨大 ArrayBuffer。
     */
    async function downloadAllZip(btn) {
      if (zipDownloading || messageSending) return;
      zipDownloading = true;
      btn.disabled = true;
      reportProgress({type:'start', scope:'zip', title:'正在打包下载文件', detail:'正在读取上传记录', percent:0, indeterminate:false});

      // Strictly serial: do not open the next request until the current file
      // has fully resolved or its abort/retry handling has completed.
      const ATTEMPTS = 3;
      const CONNECT_TIMEOUT_MS = 35000;
      const READ_IDLE_TIMEOUT_MS = 60000;
      const FILE_DEADLINE_MS = 150000;
      const MAX_ZIP32 = 0xFFFFFFFF;
      const enc = new TextEncoder();
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const cleanName = (v, fallback) => String(v || fallback).replace(/[\\/\x00-\x1f<>:"|?*]/g, '_').trim().slice(0, 145) || fallback;
      const CRC_TABLE = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let n = i;
        for (let j = 0; j < 8; j++) n = (n & 1) ? (0xEDB88320 ^ (n >>> 1)) : (n >>> 1);
        CRC_TABLE[i] = n >>> 0;
      }
      const crcStep = (crc, bytes) => {
        for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
        return crc >>> 0;
      };
      function zipStamp(value) {
        const candidate = new Date(value || Date.now());
        const d = Number.isFinite(candidate.getTime()) ? candidate : new Date();
        const year = Math.min(2107, Math.max(1980, d.getFullYear() || 1980));
        return {
          time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31),
          date: ((year - 1980) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
        };
      }
      function localHeader(entry, name) {
        const output = new Uint8Array(30 + name.length);
        const dv = new DataView(output.buffer);
        dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true);
        dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true); // UTF-8, STORE
        dv.setUint16(10, entry.stamp.time, true); dv.setUint16(12, entry.stamp.date, true);
        dv.setUint32(14, entry.crc, true);
        dv.setUint32(18, entry.blob.size, true); dv.setUint32(22, entry.blob.size, true);
        dv.setUint16(26, name.length, true); output.set(name, 30);
        return output;
      }
      function centralHeader(entry, name, offset) {
        const output = new Uint8Array(46 + name.length);
        const dv = new DataView(output.buffer);
        dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true);
        dv.setUint16(6, 20, true); dv.setUint16(8, 0x0800, true);
        dv.setUint16(10, 0, true); dv.setUint16(12, entry.stamp.time, true);
        dv.setUint16(14, entry.stamp.date, true); dv.setUint32(16, entry.crc, true);
        dv.setUint32(20, entry.blob.size, true); dv.setUint32(24, entry.blob.size, true);
        dv.setUint16(28, name.length, true); dv.setUint32(42, offset, true);
        output.set(name, 46);
        return output;
      }
      async function assembleZip(entries) {
        if (entries.length > 65535) throw new Error('文件数超出 ZIP32 限制（65535 个）');
        const parts = [], directory = [];
        let offset = 0, directorySize = 0;
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i], name = enc.encode(entry.path);
          if (name.length > 65535 || entry.blob.size > MAX_ZIP32)
            throw new Error('文件名过长或单个文件超过 ZIP32 4GB 限制');
          const header = localHeader(entry, name);
          const cd = centralHeader(entry, name, offset);
          parts.push(header, entry.blob);
          directory.push(cd); directorySize += cd.length;
          offset += header.length + entry.blob.size;
          if (offset + directorySize + 22 > MAX_ZIP32)
            throw new Error('打包数据超过 4GB，当前浏览器 ZIP32 方式不支持，请分批下载');
          if (i % 12 === 11) {
            reportProgress({type:'update', title:'正在整理 ZIP 文件目录…', percent:95 + Math.floor(4 * (i + 1) / entries.length),
              detail:`已整理 ${i + 1}/${entries.length} 个文件`});
            await pause(0);
          }
        }
        const ending = new Uint8Array(22), dv = new DataView(ending.buffer);
        dv.setUint32(0, 0x06054b50, true);
        dv.setUint16(8, entries.length, true); dv.setUint16(10, entries.length, true);
        dv.setUint32(12, directorySize, true); dv.setUint32(16, offset, true);
        return new Blob([...parts, ...directory, ending], {type:'application/zip'});
      }
      function deadline(task, milliseconds, controller, label) {
        let timer;
        const expired = new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            const error = new Error(`${label}超时（${Math.ceil(milliseconds / 1000)} 秒）`);
            error.retryable = true;
            reject(error);
          }, Math.max(1, milliseconds));
        });
        return Promise.race([Promise.resolve().then(task), expired]).finally(() => clearTimeout(timer));
      }
      async function retrieve(job, tryNumber, notify) {
        const controller = new AbortController();
        const begun = Date.now();
        const remaining = () => FILE_DEADLINE_MS - (Date.now() - begun);
        let size = 0, crc = 0xFFFFFFFF;
        const chunks = [];
        const checkpoint = () => {
          const left = remaining();
          if (left <= 0) {
            controller.abort();
            const error = new Error('单个文件总下载时间超时'); error.retryable = true;
            throw error;
          }
          return left;
        };
        const heartbeat = setInterval(() => notify(job, tryNumber, size, begun), 1200);
        try {
          notify(job, tryNumber, 0, begun);
          const response = await deadline(
            () => fetch(job.url, {signal:controller.signal, cache:'default'}),
            Math.min(CONNECT_TIMEOUT_MS, checkpoint()), controller, '连接服务器');
          if (!response.ok) {
            const error = new Error(`HTTP ${response.status}`);
            error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
            throw error;
          }
          const ctype = response.headers?.get?.('content-type') || '';
          if (ctype.includes('text/html') && !/\.html?$/i.test(job.displayName)) {
            const error = new Error('服务器返回 HTML 而非文件，请检查 Pages Functions 部署');
            error.retryable = false; throw error;
          }
          if (response.body && typeof response.body.getReader === 'function') {
            const reader = response.body.getReader();
            try {
              while (true) {
                const item = await deadline(() => reader.read(), Math.min(READ_IDLE_TIMEOUT_MS, checkpoint()), controller, '读取文件内容');
                if (item.done) break;
                const chunk = item.value;
                if (!chunk?.byteLength) continue;
                size += chunk.byteLength;
                if (size > MAX_ZIP32) throw new Error('单文件超过 4GB，无法用 ZIP32 打包');
                crc = crcStep(crc, chunk);
                chunks.push(chunk);
                notify(job, tryNumber, size, begun);
              }
            } finally {
              try { reader.releaseLock(); } catch (_) {}
            }
          } else {
            // Some browsers/test environments provide arrayBuffer() only.
            const bytes = new Uint8Array(await deadline(() => response.arrayBuffer(),
              Math.min(READ_IDLE_TIMEOUT_MS, checkpoint()), controller, '读取文件内容'));
            size = bytes.length; crc = crcStep(crc, bytes); chunks.push(bytes);
          }
          if (size === 0) {
            const error = new Error('收到空文件，已跳过以避免生成损坏的附件');
            error.retryable = true; throw error;
          }
          const expected = Number(response.headers?.get?.('content-length'));
          const contentEncoding = String(response.headers?.get?.('content-encoding') || '').toLowerCase();
          if (expected > 0 && expected !== size) {
            // Browsers transparently decompress HTTP entities, so the body
            // byte length may differ from Content-Length. Missing bytes in
            // identity-coded responses are still considered a retriable error.
            if (!contentEncoding || contentEncoding === 'identity') {
              const error = new Error(`文件未读取完整（收到 ${size} / ${expected} 字节）`);
              error.retryable = true; throw error;
            }
          }
          return {path: job.path, blob: new Blob(chunks), crc: (crc ^ 0xFFFFFFFF) >>> 0, stamp: job.stamp};
        } finally {
          clearInterval(heartbeat);
          controller.abort();
        }
      }
      try {
        if (!uploadsFetchedAt) {
          // Metadata lookup must not leave the modal waiting forever either.
          let metadataTimer;
          try {
            await Promise.race([
              loadUploads(true),
              new Promise((_, reject) => { metadataTimer = setTimeout(
                () => reject(new Error('文件清单获取超时，请刷新列表后重试')), 20000); })
            ]);
          } finally { clearTimeout(metadataTimer); }
        }
        const snapshot = Array.isArray(uploadsData) ? uploadsData.slice() : [];
        const jobs = [];
        snapshot.forEach((upload, recordIndex) => {
          const folder = `${String(recordIndex + 1).padStart(3, '0')}_${cleanName(upload.name, '学生')}_${cleanName(upload.studentId, '无学号')}`;
          (upload.files || []).forEach((file, fileIndex) => {
            const fileName = cleanName(normalizeUploadFileName(file), `附件_${fileIndex + 1}`);
            jobs.push({
              url: uploadDownloadUrl(upload.id, file),
              path: `${folder}/${String(fileIndex + 1).padStart(2, '0')}_${fileName}`,
              displayName: fileName,
              stamp: zipStamp(upload.uploadedAt)
            });
          });
        });
        if (!jobs.length) throw new Error('没有需要打包的文件');
        const outcomes = new Array(jobs.length);
        let settled = 0, successes = 0, failed = 0;
        reportProgress({type:'update', title:'正在获取文件…', percent:0});
        // Intentionally do NOT use Promise.all() or a worker queue. Only one
        // upload URL is ever requested at a time, including all retries.
        for (let index = 0; index < jobs.length; index++) {
          const job = jobs[index];
          let result = null;
          for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
            try {
              result = {ok:true, entry:await retrieve(job, attempt, () => {})};
              break;
            } catch(error) {
              const message = String(error?.message || '未知错误');
              if (attempt === ATTEMPTS || error?.retryable === false) {
                result = {ok:false, name:job.displayName, message};
              } else {
                // A short pause gives Cloudflare/Gitee time to release the
                // previous connection before using the exact same file URL.
                await pause(attempt * 900);
              }
            }
          }
          outcomes[index] = result;
          if (result?.ok) successes++; else failed++;
          settled++;
          reportProgress({type:'update', title:'正在获取文件…', percent:Math.floor(settled / jobs.length * 95)});
          if (index < jobs.length - 1) await pause(160);
        }
        if (!successes) {
          const explanation = outcomes.filter(o => o && !o.ok).slice(0, 3).map(o => `${o.name}：${o.message}`).join('；');
          throw new Error(`全部 ${jobs.length} 个文件均无法获取。${explanation}`);
        }
        const entries = outcomes.filter(o => o?.ok).map(o => o.entry);
        const errors = outcomes.filter(o => o && !o.ok);
        if (errors.length) {
          const report = '\uFEFF以下文件未能加入此压缩包，请单独下载或联系管理员：\r\n\r\n' +
            errors.map((item, i) => `${i+1}. ${item.name}\r\n   原因：${item.message}`).join('\r\n\r\n');
          const bytes = enc.encode(report);
          entries.push({path:'下载失败清单.txt', blob:new Blob([bytes]), crc:(crcStep(0xFFFFFFFF, bytes) ^ 0xFFFFFFFF) >>> 0, stamp:zipStamp()});
        }
        reportProgress({type:'update', title:'正在创建 ZIP 文件…', percent:95,
          detail:`已获取 ${successes} 个文件，正在写入标准 ZIP 目录${errors.length ? `；${errors.length} 个失败文件会列入清单` : ''}`});
        const archive = await assembleZip(entries);
        const objectUrl = URL.createObjectURL(archive);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = `uploads_${Date.now()}${errors.length ? '_部分文件' : ''}.zip`;
        document.body.appendChild(anchor);
        anchor.click(); anchor.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 120000);
        reportProgress({type:'update', percent:100});
        reportProgress({type: errors.length ? 'error' : 'success',
          title:errors.length ? '已开始下载（部分文件未获取）' : '打包下载已开始',
          detail:errors.length
            ? `成功 ${successes}/${jobs.length} 个文件，失败 ${errors.length} 个。ZIP 内已附“下载失败清单.txt”，请核对后使用。`
            : `全部 ${successes} 个文件已打包，浏览器正在保存 ZIP。`});
      } catch (error) {
        reportProgress({type:'error', title:'打包下载失败', detail:error?.message || '无法获取文件或创建压缩包'});
      } finally {
        zipDownloading = false;
        btn.disabled = false;
      }
    }

    /* ===== 提交状态：优先呈现已有快照，并在后台校准 ===== */
    const SNAPSHOT_KEY = 'credit:submission-status:v18:' + String(user.username || 'admin');
    let submissionData = {submitted: [], notSubmitted: []};
    let submissionReady = false;
    let submissionUpdatedAt = 0;
    let currentSubmissionTab = 'submitted';
    let submissionAutoRefreshTimer = null;
    let submissionRefreshPromise = null;
    try {
      const stored = JSON.parse(sessionStorage.getItem(SNAPSHOT_KEY) || 'null');
      if (stored && Array.isArray(stored.submitted) && Array.isArray(stored.notSubmitted)) {
        submissionData = {submitted:stored.submitted, notSubmitted:stored.notSubmitted};
        submissionUpdatedAt = stored.updatedAt || 0;
        submissionReady = true;
        vm.adminSubmissionReady=true;
        vm.adminSubmissionRows={submitted:[...submissionData.submitted],notSubmitted:[...submissionData.notSubmitted]};
        vm.adminSubmissionUpdatedAt=submissionUpdatedAt;
      }
    } catch {}

    function setSubmissionSyncStatus(label) {vm.adminSubmissionStatus=label;}


    function updateSubmissionSnapshot(studentsList,uploads){
      if(!Array.isArray(studentsList)||!Array.isArray(uploads))return;
      const grouped=new Map();
      for(const item of uploads){
        const sid=String(item.studentId??'');
        if(!grouped.has(sid))grouped.set(sid,{name:item.name||'',studentId:sid,count:0,lastTime:0,fileCount:0});
        const row=grouped.get(sid);row.count++;
        const time=typeof item.uploadedAt==='number'?item.uploadedAt:Date.parse(item.uploadedAt)||0;
        row.lastTime=Math.max(row.lastTime,time);
        row.fileCount+=Array.isArray(item.files)?item.files.length:0;
      }
      submissionData={submitted:[...grouped.values()],notSubmitted:studentsList.filter(st=>!grouped.has(String(st.studentId??''))).map(st=>({name:st.name||'',studentId:String(st.studentId??'')}))};
      submissionReady=true;submissionUpdatedAt=Date.now();
      vm.adminSubmissionRows={submitted:[...submissionData.submitted],notSubmitted:[...submissionData.notSubmitted]};
      vm.adminSubmissionReady=true;vm.adminSubmissionUpdatedAt=submissionUpdatedAt;
      try{sessionStorage.setItem(SNAPSHOT_KEY,JSON.stringify({...submissionData,updatedAt:submissionUpdatedAt}));}catch{}
      if(vm.adminSubmissionOpen)setSubmissionSyncStatus('列表已更新 · 每 8 秒自动检查');
    }
    function openSubmissionModal(){
      vm.adminSubmissionOpen=true;
      setSubmissionSyncStatus(submissionReady?'显示已有列表，后台同步中…':'正在获取首次列表…');
      requestAnimationFrame(()=>{void refreshSubmissionData()});
      if(submissionAutoRefreshTimer)clearInterval(submissionAutoRefreshTimer);
      submissionAutoRefreshTimer=setInterval(()=>{if(vm.adminSubmissionOpen)void refreshSubmissionData();},8000);
    }
    function closeSubmissionModal(){
      vm.adminSubmissionOpen=false;
      if(submissionAutoRefreshTimer){clearInterval(submissionAutoRefreshTimer);submissionAutoRefreshTimer=null;}
    }
    function refreshSubmissionData(manual=false){
      if(submissionRefreshPromise)return submissionRefreshPromise;
      setSubmissionSyncStatus(submissionReady?'正在同步最新数据…':'正在获取首次列表…');
      submissionRefreshPromise=(async()=>{
        try{
          const now=Date.now();
          const [studentsList,uploads]=await Promise.all([
            (!manual&&studentsFetchedAt&&now-studentsFetchedAt<15000)?Promise.resolve(students):apiCache.get('/api/students',{ttl:15000,force:!!manual,fetchOpts:{headers:authHeader}}),
            (!manual&&uploadsFetchedAt&&now-uploadsFetchedAt<8000)?Promise.resolve(uploadsData):
              (uploadsLoadPromise?uploadsLoadPromise.then(()=>uploadsData):apiCache.get('/api/files',{ttl:8000,force:!!manual,fetchOpts:{headers:authHeader}}))
          ]);
          students=studentsList;studentsFetchedAt=Date.now();uploadsData=uploads;uploadsFetchedAt=Date.now();
          updateSubmissionSnapshot(studentsList,uploads);
        }catch(e){console.warn('[submission status refresh]',e);setSubmissionSyncStatus(submissionReady?'同步失败 · 正在显示上次列表':'加载失败，请点击刷新重试');if(manual)throw e;}
      })().finally(()=>{submissionRefreshPromise=null;});
      return submissionRefreshPromise;
    }
    function switchSubmissionTab(tab){
      if(!['submitted','notSubmitted'].includes(tab))return;
      currentSubmissionTab=tab;vm.adminSubmissionTab=tab;vm.adminExcelExportResult='';
    }
    function renderSubmissionTable(){/* Vue derives rows from adminSubmissionRows */}

    /** Vue-owned Excel export progress; unchanged XLSX adapter/filename and columns. */
    async function exportSubmissionExcel(btn){
      if(vm.adminExcelExportBusy)return;
      if(!vm.adminSubmissionReady||!vm.adminSubmissionVisible.length){flashError('当前没有可导出的数据');return;}
      vm.adminExcelExportBusy=true;vm.adminExcelExportResult='正在生成 Excel…';
      try{
        const submitted=vm.adminSubmissionTab==='submitted';
        const rows=vm.adminSubmissionVisible;
        const data=submitted?rows.map(s=>({姓名:String(s.name??''),学号:String(s.studentId??''),提交次数:s.count,文件数:s.fileCount,最近提交:new Date(s.lastTime).toLocaleString('zh-CN')})):
          rows.map(s=>({姓名:String(s.name??''),学号:String(s.studentId??'')}));
        const sheetName=submitted?'已交名单':'未交名单';
        const ws=XLSX.utils.json_to_sheet(data),wb=XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb,ws,sheetName);
        await XLSX.writeFile(wb,`${sheetName}_${Date.now()}.xlsx`);
        vm.adminExcelExportResult=`已导出 ${data.length} 条记录`;
        flashSuccess(vm.adminExcelExportResult);
      }catch(error){vm.adminExcelExportResult='导出失败：'+(error.message||'组件异常');flashError(vm.adminExcelExportResult);}
      finally{vm.adminExcelExportBusy=false;}
    }

    /* ===== 跨标签页同步 ===== */
    if (window.syncBus) {
      syncBus.on('apps', function () {
        apiCache.invalidatePrefix('/api/');
      });
      syncBus.on('students', function () {
        apiCache.invalidate('/api/students');
      });
      syncBus.on('files', function () {
        apiCache.invalidate('/api/files');
      });
      syncBus.on('settings', function () {
        apiCache.invalidate('/api/settings');
      });
      syncBus.on('admins', function () {
        apiCache.invalidate('/api/admin');
      });
      syncBus.on('messages', function () {
        apiCache.invalidatePrefix('/api/messages');
      });
    }

    function logout() {
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminUser');
      localStorage.removeItem('aboutWriteToken');
      apiCache.clear();
      
      window.CreditRouteGuard.navigateAway('/login.html', true);
    }
    Promise.all([loadAdmins(), loadEntrySettings(), loadStudents()])
      .catch(e => console.error('init error:', e));
  
    window.escapeHtml = escapeHtml;
    window.startFileAutoRefresh = startFileAutoRefresh;
    window.stopFileAutoRefresh = stopFileAutoRefresh;
    window.renderAdminTable = renderAdminTable;
    window.loadAdmins = loadAdmins;
    window.togglePerm = togglePerm;
    window.toggleBanPerm = toggleBanPerm;
    window.createAdmin = createAdmin;
    window.deleteAdmin = deleteAdmin;
    window.loadStudents = loadStudents;
    window.renderStudentTable = renderStudentTable;
    window.toggleAllStudents = toggleAllStudents;
    window.updateStudentSelectedCount = updateStudentSelectedCount;
    window.addStudent = addStudent;
    window.deleteSelectedStudents = deleteSelectedStudents;
    window.toggleBanStudent = toggleBanStudent;
    window.resetStudentPassword = resetStudentPassword;
    window.importStudents = importStudents;
    window.loadMsgStudentList = loadMsgStudentList;
    window.toggleMsgStudent = toggleMsgStudent;
    window.selectAllMsgStudents = selectAllMsgStudents;
    window.clearAllMsgStudents = clearAllMsgStudents;
    window.updateMsgSelectedCount = updateMsgSelectedCount;
    window.sendCustomMessage = sendCustomMessage;
    window.scanRedundantData = scanRedundantData;
    window.cleanRedundantData = cleanRedundantData;
    window.changePassword = changePassword;
    window.clearData = clearData;
    window.loadLogs = loadLogs;
    window.loadEntrySettings = loadEntrySettings;
    window.updateEntryUI = updateEntryUI;
    window.toggleEntry = toggleEntry;
    window.saveEntrySettings = saveEntrySettings;
    window.updateFileUploadUI = updateFileUploadUI;
    window.toggleFileUpload = toggleFileUpload;
    window.toggleMultiple = toggleMultiple;
    window.updateFileSizePreview = updateFileSizePreview;
    window.updateDeadlinePreview = updateDeadlinePreview;
    window.saveFileUploadSettings = saveFileUploadSettings;
    window.updateRequirementUI = updateRequirementUI;
    window.toggleRequirement = toggleRequirement;
    window.saveRequirementSettings = saveRequirementSettings;
    window.updateAnnouncementUI = updateAnnouncementUI;
    window.toggleAnnouncement = toggleAnnouncement;
    window.saveAnnouncementSettings = saveAnnouncementSettings;
    window.loadUploads = loadUploads;
    window.renderUploads = renderUploads;
    window.deleteUpload = deleteUpload;
    window.downloadAllZip = downloadAllZip;
    window.openSubmissionModal = openSubmissionModal;
    window.closeSubmissionModal = closeSubmissionModal;
    window.refreshSubmissionData = refreshSubmissionData;
    window.switchSubmissionTab = switchSubmissionTab;
    window.renderSubmissionTable = renderSubmissionTable;
    window.exportSubmissionExcel = exportSubmissionExcel;
    window.logout = logout;

    return () => { stopFileAutoRefresh(); if (submissionAutoRefreshTimer) clearInterval(submissionAutoRefreshTimer); window.__onAdminTabChange = null; window.__vueAdminUpdate = null; window.__vueAdminError = null; };
}
