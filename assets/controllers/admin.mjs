/** Vue 3 page controller — admin.
 * Mounted by the Vue PageContent component; API operations remain unchanged.
 * Business DOM fragments from the pre-Vue project are preserved for compatibility.
 */
export function mount() {

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
      if (tab === 'logs') loadLogs();
      if (tab === 'files') { void loadUploads(true).catch(e => console.warn('[file list]', e)); startFileAutoRefresh(); }
      else stopFileAutoRefresh();
      if (tab === 'students') loadStudents();
      if (tab === 'messages') loadMsgStudentList();
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
      try {
        students = await apiCache.get('/api/students', {
          ttl: TTL.students, force, fetchOpts: { headers: authHeader }
        });
        studentsFetchedAt = Date.now();
        renderStudentTable();
        if (uploadsFetchedAt) updateSubmissionSnapshot(students, uploadsData);
      } catch (e) {
        document.getElementById('studentTableBody').innerHTML = `<tr><td colspan="6" class="empty-state">加载失败：${escapeHtml(e.message)}</td></tr>`;
      }
    }

    function renderStudentTable() {
      const tbody = document.getElementById('studentTableBody');
      const empty = document.getElementById('studentEmpty');
      if (students.length === 0) {
        tbody.innerHTML = '';
        if (empty) empty.style.display = 'block';
        return;
      }
      if (empty) empty.style.display = 'none';
      tbody.innerHTML = students.map(s => {
        const isBanned = s.banned || false;
        const statusBadge = isBanned ? '<span class="badge badge-danger">已封禁</span>' : '<span class="badge badge-success">正常</span>';
        const pwdDisplay = s.password ? `<code class="pwd-code">${escapeHtml(s.password)}</code>` : '<span style="color:#94a3b8;">未设置</span>';
        return `<tr data-sid="${escapeHtml(s.studentId)}">
          <td><input type="checkbox" class="checkbox student-checkbox" value="${escapeHtml(s.studentId)}" onchange="updateStudentSelectedCount()" /></td>
          <td>${escapeHtml(s.name)}</td>
          <td>${escapeHtml(s.studentId)}</td>
          <td>${pwdDisplay}</td>
          <td>${statusBadge}</td>
          <td style="white-space:nowrap;">
            <button class="btn btn-warning btn-small" onclick="resetStudentPassword(this, '${escapeHtml(s.studentId)}', '${escapeHtml(s.password || '')}')" style="margin-right:4px;">重置密码</button>
            <button class="btn btn-warning btn-small" onclick="toggleBanStudent(this, '${escapeHtml(s.studentId)}', ${isBanned})">${isBanned ? '解封' : '封禁'}</button>
          </td>
        </tr>`;
      }).join('');
    }

    function toggleAllStudents() {
      const checked = document.getElementById('selectAllStudents').checked || document.getElementById('selectAllTable').checked;
      document.querySelectorAll('.student-checkbox').forEach(cb => cb.checked = checked);
      updateStudentSelectedCount();
    }

    function updateStudentSelectedCount() {
      const checked = document.querySelectorAll('.student-checkbox:checked').length;
      const el = document.getElementById('selectedCount');
      if (el) el.textContent = checked;
      const total = document.querySelectorAll('.student-checkbox').length;
      const allChecked = total > 0 && checked === total;
      const s1 = document.getElementById('selectAllStudents');
      const s2 = document.getElementById('selectAllTable');
      if (s1) s1.checked = allChecked;
      if (s2) s2.checked = allChecked;
    }

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
      const checked = document.querySelectorAll('.student-checkbox:checked');
      if (checked.length === 0) { flashError('请至少选择一个学生'); return; }
      showConfirm('确认删除', `确定要删除选中的 ${checked.length} 名学生吗？`, '确定', '取消', async function (confirmed) {
        if (!confirmed) return;
        const studentIds = Array.from(checked).map(cb => cb.value);
        await withLoading(btn, async () => {
          try {
            await Promise.all(studentIds.map(id =>
              fetch('/api/students', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json', ...authHeader },
                body: JSON.stringify({ studentId: id })
              })
            ));
            flashSuccess(`已删除 ${studentIds.length} 名学生`);
            apiCache.invalidate('/api/students');
            if (window.syncBus) syncBus.emit('students', { action: 'delete', studentIds });
            loadStudents(true);
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
          const row = document.querySelector(`tr[data-sid="${studentId}"]`);
          pulseElement(row, 'success');
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

    function importStudents(btn) {
      const fileInput = document.getElementById('fileInput');
      const file = fileInput.files[0];
      if (!file) { flashError('请选择文件'); return; }
      const progressContainer = document.getElementById('importProgress');
      const progressFill = document.getElementById('importProgressFill');
      const progressText = document.getElementById('importProgressText');
      const resultEl = document.getElementById('importResult');

      progressContainer.style.display = 'block';
      progressFill.style.width = '0%';
      progressText.textContent = '0%';
      resultEl.textContent = '正在解析文件...';

      const reader = new FileReader();
      reader.onload = async function (e) {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(firstSheet);
          const headers = Object.keys(jsonData[0] || {});
          const nameKey = headers.find(h => /姓名|name/i.test(h));
          const idKey = headers.find(h => /学号|studentid/i.test(h));
          const pwdKey = headers.find(h => /密码|password/i.test(h));
          if (!nameKey || !idKey) {
            flashError('未找到"姓名"和"学号"列');
            progressContainer.style.display = 'none';
            return;
          }
          const studentsToAdd = jsonData.map(row => ({
            name: String(row[nameKey]).trim(),
            studentId: String(row[idKey]).trim(),
            password: pwdKey ? String(row[pwdKey]).trim() : '',
          })).filter(s => s.name && s.studentId);
          if (studentsToAdd.length === 0) {
            flashError('没有有效数据');
            progressContainer.style.display = 'none';
            return;
          }
          resultEl.textContent = `共 ${studentsToAdd.length} 条，开始导入...`;
          let success = 0, fail = 0;
          const total = studentsToAdd.length;
          for (let i = 0; i < total; i++) {
            const s = studentsToAdd[i];
            try {
              const res = await fetch('/api/students', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeader },
                body: JSON.stringify({ name: s.name, studentId: s.studentId, password: s.password })
              });
              if (res.ok) success++; else fail++;
            } catch (err) { fail++; }
            const percent = Math.round(((i + 1) / total) * 100);
            progressFill.style.width = percent + '%';
            progressText.textContent = `${percent}% (${i + 1}/${total})`;
          }
          resultEl.textContent = `导入完成：成功 ${success} 条，失败 ${fail} 条`;
          progressFill.style.width = '100%';
          progressText.textContent = `100% (${total}/${total})`;
          setTimeout(() => { progressContainer.style.display = 'none'; }, 3000);
          apiCache.invalidate('/api/students');
          if (window.syncBus) syncBus.emit('students', { action: 'import' });
          loadStudents(true);
          if (fail === 0) flashSuccess(`成功导入 ${success} 条`);
          else flashError(`导入完成：成功 ${success}，失败 ${fail}`);
        } catch (err) {
          flashError('解析失败：' + err.message);
          progressContainer.style.display = 'none';
        }
      };
      reader.readAsArrayBuffer(file);
    }

    /* ===== 消息发送 ===== */
    let msgStudentList = [];
    let msgSelected = new Set();

    async function loadMsgStudentList() {
      const listEl = document.getElementById('msgStudentList');
      listEl.innerHTML = '<div class="empty-state">加载中...</div>';
      try {
        msgStudentList = await apiCache.get('/api/students', {
          ttl: TTL.students, fetchOpts: { headers: authHeader }
        });
        if (msgStudentList.length === 0) {
          listEl.innerHTML = '<div class="empty-state">暂无学生</div>';
          return;
        }
        listEl.innerHTML = msgStudentList.map(s => `
          <label class="student-option" data-id="${escapeHtml(s.studentId)}">
            <input type="checkbox" value="${escapeHtml(s.studentId)}" onchange="toggleMsgStudent(this)" ${msgSelected.has(s.studentId) ? 'checked' : ''}>
            <span class="student-name">${escapeHtml(s.name)}</span>
            <span class="student-id">${escapeHtml(s.studentId)}</span>
          </label>
        `).join('');
        updateMsgSelectedCount();
      } catch (e) {
        listEl.innerHTML = `<div class="empty-state">加载失败：${escapeHtml(e.message)}</div>`;
      }
    }

    function toggleMsgStudent(checkbox) {
      const id = checkbox.value;
      if (checkbox.checked) msgSelected.add(id);
      else msgSelected.delete(id);
      updateMsgSelectedCount();
    }

    function selectAllMsgStudents() {
      msgSelected.clear();
      msgStudentList.forEach(s => msgSelected.add(s.studentId));
      document.querySelectorAll('#msgStudentList input[type="checkbox"]').forEach(cb => cb.checked = true);
      updateMsgSelectedCount();
    }

    function clearAllMsgStudents() {
      msgSelected.clear();
      document.querySelectorAll('#msgStudentList input[type="checkbox"]').forEach(cb => cb.checked = false);
      updateMsgSelectedCount();
    }

    function updateMsgSelectedCount() {
      const el = document.getElementById('msgSelectedCount');
      if (el) el.textContent = msgSelected.size;
    }

    async function sendCustomMessage(btn) {
      if (messageSending || zipDownloading) return;
      const title = document.getElementById('msgTitle').value.trim();
      const content = document.getElementById('msgContent').value.trim();
      const resultDiv = document.getElementById('msgSendResult');
      if (!title) { flashError('请填写消息标题'); return; }
      if (!content) { flashError('请填写消息内容'); return; }
      if (msgSelected.size === 0) { flashError('请至少选择一个学生'); return; }
      showConfirm('确认发送', `确定向选中的 ${msgSelected.size} 名学生发送消息吗？`, '确定发送', '取消', async confirmed => {
        if (!confirmed || messageSending) return;
        messageSending = true;
        btn.disabled = true;
        const recipients = [...msgSelected]; // freeze the recipients for the operation
        let success = 0, fail = 0;
        const failedIds = [];
        resultDiv.textContent = '';
        reportProgress({type:'start', title:'正在发送消息…', detail:`准备发送给 ${recipients.length} 名学生`, indeterminate:false});
        try {
          // Keep messages sequential: each request updates the same Gitee JSON SHA.
          // Concurrent POSTs here could lose messages due to conflicting writes.
          for (let i = 0; i < recipients.length; i++) {
            const studentId = recipients[i];
            try {
              const res = await fetch('/api/messages', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body:JSON.stringify({studentId, title, content, type:'system'})
              });
              if (res.ok) success++;
              else { fail++; failedIds.push(studentId); }
            } catch { fail++; failedIds.push(studentId); }
            reportProgress({type:'update', percent:((i+1)/recipients.length)*100,
              detail:`已处理 ${i+1}/${recipients.length} 人 · 成功 ${success} · 失败 ${fail}`});
          }
          resultDiv.textContent = `发送完成：成功 ${success} 条，失败 ${fail} 条`;
          resultDiv.style.color = fail ? '#c2410c' : '#15803d';
          if (success) {
            window.syncBus?.emit('messages', {action:'send'});
            if (!fail) {
              document.getElementById('msgTitle').value = '';
              document.getElementById('msgContent').value = '';
              clearAllMsgStudents();
            } else {
              // Allow retrying only unsuccessful recipients without duplicating delivered messages.
              msgSelected = new Set(failedIds);
              document.querySelectorAll('#msgStudentList input[type="checkbox"]').forEach(cb => cb.checked = msgSelected.has(cb.value));
              updateMsgSelectedCount();
            }
          }
          reportProgress({type:fail ? 'error':'success',
            title:fail ? '消息发送部分失败':'消息发送完成',
            detail:`成功 ${success} 条，失败 ${fail} 条${fail ? '。失败的学生已保留勾选，可重试。' : '。全部接收人已处理。'}`});
        } catch(e) {
          reportProgress({type:'error', title:'消息发送失败', detail:e.message || '网络请求异常，请检查消息状态'});
        } finally {
          messageSending = false;
          btn.disabled = false;
        }
      });
    }

    /* ===== 系统维护 ===== */
    async function scanRedundantData(btn) {
      await withLoading(btn, async () => {
        try {
          const data = await apiCache.get('/api/maintenance?action=scan', {
            ttl: 0, fetchOpts: { headers: authHeader }
          });
          document.getElementById('maintenanceStats').style.display = 'grid';
          document.getElementById('statTotalCount').textContent = data.totalCount;
          document.getElementById('statValidCount').textContent = data.totalCount - data.count;
          document.getElementById('statRedundantCount').textContent = data.count;
          const sizeKB = (data.sizeBytes / 1024).toFixed(2);
          document.getElementById('statRedundantSize').innerHTML = `${sizeKB}<span class="stat-unit">KB</span>`;
          if (data.count > 0) {
            document.getElementById('redundantListWrap').style.display = 'block';
            document.getElementById('redundantEmpty').style.display = 'none';
            document.getElementById('redundantTableBody').innerHTML = data.apps.map(a => `
              <tr>
                <td>${escapeHtml(a.name || '未知')}</td>
                <td>${escapeHtml(a.packageName || '')}</td>
                <td>${escapeHtml(a.versionName || '')}</td>
                <td><span style="padding:2px 8px;border-radius:12px;background:#fee2e2;color:#991b1b;font-size:12px;">${escapeHtml(a.status || '未知')}</span></td>
                <td>${a.createdAt ? new Date(a.createdAt).toLocaleString('zh-CN') : '-'}</td>
              </tr>
            `).join('');
          } else {
            document.getElementById('redundantListWrap').style.display = 'block';
            document.getElementById('redundantTableBody').innerHTML = '';
            document.getElementById('redundantEmpty').style.display = 'block';
          }
          flashSuccess(`扫描完成，发现 ${data.count} 条冗余数据`);
        } catch (e) {
          flashError('扫描失败：' + e.message);
        }
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
                document.getElementById('maintenanceStats').style.display = 'none';
                document.getElementById('redundantListWrap').style.display = 'none';
                scanRedundantData();
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
    async function loadLogs(force = false) {
      const tbody = document.getElementById('logTableBody');
      const empty = document.getElementById('logEmpty');
      try {
        const logs = await apiCache.get('/api/admin?action=login-logs', {
          ttl: TTL.logs, force, fetchOpts: { headers: authHeader }
        });
        if (logs.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
        empty.style.display = 'none';
        tbody.innerHTML = logs.map(log => `
          <tr>
            <td>${escapeHtml(log.username)}</td>
            <td>${escapeHtml(new Date(log.time).toLocaleString('zh-CN'))}</td>
            <td>${escapeHtml(log.ip || '未知')}</td>
            <td style="font-size:12px;word-break:break-all;">${escapeHtml(log.userAgent || '未知')}</td>
          </tr>
        `).join('');
      } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" class="empty-state">加载失败：${escapeHtml(e.message)}</td></tr>`;
        if (force) throw e;
      }
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
      const btn = document.getElementById('toggleEntryBtn');
      const status = document.getElementById('entryStatus');
      const msg = document.getElementById('entryMessage');
      if (entrySettings.enabled) {
        btn.textContent = '关闭'; btn.className = 'btn btn-danger';
        status.textContent = '当前：开启'; status.style.color = '#10b981';
      } else {
        btn.textContent = '开启'; btn.className = 'btn btn-success';
        status.textContent = '当前：关闭'; status.style.color = '#ef4444';
      }
      msg.value = entrySettings.message || '';
    }

    function toggleEntry() { entrySettings.enabled = !entrySettings.enabled; updateEntryUI(); }

    async function saveEntrySettings(btn) {
      const message = document.getElementById('entryMessage').value.trim();
      const resultDiv = document.getElementById('entrySaveResult');
      await withLoading(btn, async () => {
        resultDiv.textContent = '保存中...';
        try {
          const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader },
            body: JSON.stringify({ enabled: entrySettings.enabled, message })
          });
          const data = await res.json();
          if (res.ok) {
            resultDiv.textContent = '保存成功'; resultDiv.style.color = '#10b981';
            apiCache.invalidate('/api/settings');
            if (window.syncBus) syncBus.emit('settings', { action: 'update' });
            flashSuccess('设置已保存');
            setTimeout(() => { resultDiv.textContent = ''; }, 3000);
          } else {
            resultDiv.textContent = (data.error || '保存失败'); resultDiv.style.color = '#ef4444';
            flashError(data.error || '保存失败');
          }
        } catch (e) {
          resultDiv.textContent = '网络错误'; resultDiv.style.color = '#ef4444';
          flashError('网络错误');
        }
      });
    }

    function updateFileUploadUI() {
      const btn1 = document.getElementById('toggleFileUploadBtn');
      const status1 = document.getElementById('fileUploadStatus');
      if (fileUploadSettings.fileUploadEnabled) {
        btn1.textContent = '关闭'; btn1.className = 'btn btn-danger';
        status1.textContent = '当前：开启'; status1.style.color = '#10b981';
      } else {
        btn1.textContent = '开启'; btn1.className = 'btn btn-success';
        status1.textContent = '当前：关闭'; status1.style.color = '#ef4444';
      }
      const btn2 = document.getElementById('toggleMultipleBtn');
      const status2 = document.getElementById('multipleStatus');
      if (fileUploadSettings.allowMultipleFiles) {
        btn2.textContent = '禁止'; btn2.className = 'btn btn-danger';
        status2.textContent = '当前：允许'; status2.style.color = '#10b981';
      } else {
        btn2.textContent = '允许'; btn2.className = 'btn btn-success';
        status2.textContent = '当前：禁止'; status2.style.color = '#ef4444';
      }
      document.getElementById('maxSubmissions').value = fileUploadSettings.maxSubmissionsPerStudent || 1;

      const maxMB = fileUploadSettings.maxFileSizeMB || 20;
      document.querySelectorAll('input[name="fileSizeMode"]').forEach(r => r.checked = false);
      const customSizeInput = document.getElementById('customFileSize');
      customSizeInput.style.display = 'none';
      if (maxMB === 20) document.querySelector('input[name="fileSizeMode"][value="20"]').checked = true;
      else if (maxMB === 50) document.querySelector('input[name="fileSizeMode"][value="50"]').checked = true;
      else if (maxMB === 100) document.querySelector('input[name="fileSizeMode"][value="100"]').checked = true;
      else {
        document.querySelector('input[name="fileSizeMode"][value="custom"]').checked = true;
        customSizeInput.style.display = 'inline-block';
        customSizeInput.value = maxMB;
      }
      document.getElementById('fileSizePreview').textContent = `当前限制：单个文件不超过 ${maxMB}MB`;

      const deadlineEnabled = fileUploadSettings.fileUploadDeadlineEnabled;
      const deadline = fileUploadSettings.fileUploadDeadline;
      document.querySelectorAll('input[name="deadlineMode"]').forEach(r => r.checked = false);
      document.getElementById('durationInputs').style.display = 'none';
      document.getElementById('dateInput').style.display = 'none';
      if (!deadlineEnabled || !deadline) {
        document.querySelector('input[name="deadlineMode"][value="none"]').checked = true;
        document.getElementById('deadlinePreview').textContent = '';
      } else {
        document.querySelector('input[name="deadlineMode"][value="date"]').checked = true;
        document.getElementById('dateInput').style.display = 'block';
        const d = new Date(deadline);
        document.getElementById('deadlineDate').value = d.toISOString().slice(0, 16);
        document.getElementById('deadlinePreview').textContent = `当前截止：${d.toLocaleString('zh-CN')}`;
      }
    }

    function toggleFileUpload() { fileUploadSettings.fileUploadEnabled = !fileUploadSettings.fileUploadEnabled; updateFileUploadUI(); }
    function toggleMultiple() { fileUploadSettings.allowMultipleFiles = !fileUploadSettings.allowMultipleFiles; updateFileUploadUI(); }

    document.querySelectorAll('input[name="fileSizeMode"]').forEach(radio => {
      radio.addEventListener('change', function () {
        const customInput = document.getElementById('customFileSize');
        if (this.value === 'custom') { customInput.style.display = 'inline-block'; customInput.focus(); }
        else { customInput.style.display = 'none'; }
        updateFileSizePreview();
      });
    });
    document.getElementById('customFileSize').addEventListener('input', updateFileSizePreview);

    function updateFileSizePreview() {
      const mode = document.querySelector('input[name="fileSizeMode"]:checked')?.value;
      const preview = document.getElementById('fileSizePreview');
      if (mode === 'custom') {
        const v = parseInt(document.getElementById('customFileSize').value) || 0;
        preview.textContent = v > 0 ? `当前限制：单个文件不超过 ${v}MB` : '请输入自定义大小';
      } else if (mode) {
        preview.textContent = `当前限制：单个文件不超过 ${mode}MB`;
      }
    }

    document.querySelectorAll('input[name="deadlineMode"]').forEach(radio => {
      radio.addEventListener('change', function () {
        document.getElementById('durationInputs').style.display = this.value === 'duration' ? 'flex' : 'none';
        document.getElementById('dateInput').style.display = this.value === 'date' ? 'block' : 'none';
        updateDeadlinePreview();
      });
    });

    function updateDeadlinePreview() {
      const mode = document.querySelector('input[name="deadlineMode"]:checked').value;
      const preview = document.getElementById('deadlinePreview');
      if (mode === 'none') { preview.textContent = '不限制'; }
      else if (mode === 'duration') {
        const h = parseInt(document.getElementById('deadlineHours').value) || 0;
        const m = parseInt(document.getElementById('deadlineMinutes').value) || 0;
        const s = parseInt(document.getElementById('deadlineSeconds').value) || 0;
        const ms = (h * 3600 + m * 60 + s) * 1000;
        if (ms > 0) preview.textContent = `截止时间：${new Date(Date.now() + ms).toLocaleString('zh-CN')}`;
        else preview.textContent = '请输入时长';
      } else if (mode === 'date') {
        const val = document.getElementById('deadlineDate').value;
        if (val) preview.textContent = `截止时间：${new Date(val).toLocaleString('zh-CN')}`;
        else preview.textContent = '请选择日期时间';
      }
    }
    ['deadlineHours', 'deadlineMinutes', 'deadlineSeconds'].forEach(id => {
      document.getElementById(id).addEventListener('input', updateDeadlinePreview);
    });
    document.getElementById('deadlineDate').addEventListener('change', updateDeadlinePreview);

    async function saveFileUploadSettings(btn) {
      const mode = document.querySelector('input[name="deadlineMode"]:checked').value;
      let deadlineTimestamp = null;
      let deadlineEnabled = false;
      if (mode === 'duration') {
        const h = parseInt(document.getElementById('deadlineHours').value) || 0;
        const m = parseInt(document.getElementById('deadlineMinutes').value) || 0;
        const s = parseInt(document.getElementById('deadlineSeconds').value) || 0;
        const ms = (h * 3600 + m * 60 + s) * 1000;
        if (ms <= 0) { flashError('请输入有效的时长'); return; }
        deadlineTimestamp = Date.now() + ms;
        deadlineEnabled = true;
      } else if (mode === 'date') {
        const val = document.getElementById('deadlineDate').value;
        if (!val) { flashError('请选择日期时间'); return; }
        deadlineTimestamp = new Date(val).getTime();
        if (deadlineTimestamp <= Date.now()) { flashError('截止时间必须晚于当前时间'); return; }
        deadlineEnabled = true;
      }
      const maxSub = parseInt(document.getElementById('maxSubmissions').value) || 1;
      if (maxSub < 1) { flashError('最大提交次数至少为1'); return; }
      let maxFileSizeMB = 20;
      const sizeMode = document.querySelector('input[name="fileSizeMode"]:checked')?.value;
      if (sizeMode === 'custom') {
        maxFileSizeMB = parseInt(document.getElementById('customFileSize').value) || 0;
        if (maxFileSizeMB < 1) { flashError('自定义文件大小至少为 1MB'); return; }
      } else if (sizeMode) { maxFileSizeMB = parseInt(sizeMode); }
      else { flashError('请选择文件大小限制'); return; }

      const payload = {
        fileUploadEnabled: fileUploadSettings.fileUploadEnabled,
        allowMultipleFiles: fileUploadSettings.allowMultipleFiles,
        fileUploadDeadline: deadlineTimestamp,
        fileUploadDeadlineEnabled: deadlineEnabled,
        maxSubmissionsPerStudent: maxSub,
        maxFileSizeMB: maxFileSizeMB,
      };
      const resultDiv = document.getElementById('fileUploadSaveResult');
      await withLoading(btn, async () => {
        resultDiv.textContent = '保存中...';
        try {
          const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (res.ok) {
            resultDiv.textContent = '保存成功'; resultDiv.style.color = '#10b981';
            apiCache.invalidate('/api/settings');
            if (window.syncBus) syncBus.emit('settings', { action: 'update' });
            flashSuccess('文件上传设置已保存');
            loadEntrySettings();
            setTimeout(() => { resultDiv.textContent = ''; }, 3000);
          } else {
            resultDiv.textContent = (data.error || '保存失败'); resultDiv.style.color = '#ef4444';
            flashError(data.error || '保存失败');
          }
        } catch (e) {
          resultDiv.textContent = '网络错误'; resultDiv.style.color = '#ef4444';
          flashError('网络错误');
        }
      });
    }

    function updateRequirementUI() {
      const btn = document.getElementById('toggleRequirementBtn');
      const status = document.getElementById('requirementStatus');
      const msg = document.getElementById('requirementMessage');
      if (requirementSettings.uploadRequirementEnabled) {
        btn.textContent = '关闭'; btn.className = 'btn btn-danger';
        status.textContent = '当前：开启'; status.style.color = '#10b981';
      } else {
        btn.textContent = '开启'; btn.className = 'btn btn-success';
        status.textContent = '当前：关闭'; status.style.color = '#ef4444';
      }
      msg.value = requirementSettings.uploadRequirementMessage || '';
    }

    function toggleRequirement() { requirementSettings.uploadRequirementEnabled = !requirementSettings.uploadRequirementEnabled; updateRequirementUI(); }

    async function saveRequirementSettings(btn) {
      const message = document.getElementById('requirementMessage').value.trim();
      const resultDiv = document.getElementById('requirementSaveResult');
      await withLoading(btn, async () => {
        resultDiv.textContent = '保存中...';
        try {
          const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader },
            body: JSON.stringify({
              uploadRequirementEnabled: requirementSettings.uploadRequirementEnabled,
              uploadRequirementMessage: message,
            })
          });
          const data = await res.json();
          if (res.ok) {
            resultDiv.textContent = '保存成功'; resultDiv.style.color = '#10b981';
            apiCache.invalidate('/api/settings');
            if (window.syncBus) syncBus.emit('settings', { action: 'update' });
            flashSuccess('弹窗设置已保存');
            setTimeout(() => { resultDiv.textContent = ''; }, 3000);
          } else {
            resultDiv.textContent = (data.error || '保存失败'); resultDiv.style.color = '#ef4444';
            flashError(data.error || '保存失败');
          }
        } catch (e) {
          resultDiv.textContent = '网络错误'; resultDiv.style.color = '#ef4444';
          flashError('网络错误');
        }
      });
    }

    function updateAnnouncementUI() {
      const btn = document.getElementById('toggleAnnouncementBtn');
      const status = document.getElementById('announcementStatus');
      const title = document.getElementById('announcementTitle');
      const msg = document.getElementById('announcementMessage');
      if (announcementSettings.announcementEnabled) {
        btn.textContent = '关闭'; btn.className = 'btn btn-danger';
        status.textContent = '当前：开启'; status.style.color = '#10b981';
      } else {
        btn.textContent = '开启'; btn.className = 'btn btn-success';
        status.textContent = '当前：关闭'; status.style.color = '#ef4444';
      }
      title.value = announcementSettings.announcementTitle || '系统公告';
      msg.value = announcementSettings.announcementMessage || '';
    }

    function toggleAnnouncement() {
      announcementSettings.announcementEnabled = !announcementSettings.announcementEnabled;
      updateAnnouncementUI();
    }

    async function saveAnnouncementSettings(btn) {
      const title = document.getElementById('announcementTitle').value.trim() || '系统公告';
      const message = document.getElementById('announcementMessage').value.trim();
      const resultDiv = document.getElementById('announcementSaveResult');
      await withLoading(btn, async () => {
        resultDiv.textContent = '保存中...';
        try {
          const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader },
            body: JSON.stringify({
              announcementEnabled: announcementSettings.announcementEnabled,
              announcementTitle: title,
              announcementMessage: message,
            })
          });
          const data = await res.json();
          if (res.ok) {
            resultDiv.textContent = '保存成功'; resultDiv.style.color = '#10b981';
            apiCache.invalidate('/api/settings');
            if (window.syncBus) syncBus.emit('settings', { action: 'update' });
            flashSuccess('公告已保存');
            setTimeout(() => { resultDiv.textContent = ''; }, 3000);
          } else {
            resultDiv.textContent = (data.error || '保存失败'); resultDiv.style.color = '#ef4444';
            flashError(data.error || '保存失败');
          }
        } catch (e) {
          resultDiv.textContent = '网络错误'; resultDiv.style.color = '#ef4444';
          flashError('网络错误');
        }
      });
    }

    /* ===== 文件管理 ===== */
    async function loadUploads(force = false) {
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
          document.getElementById('uploadTableBody').innerHTML = `<tr><td colspan="5" class="empty-state">加载失败：${escapeHtml(e.message)}</td></tr>`;
          if (force) throw e;
        }
      })().finally(() => { uploadsLoadPromise = null; });
      return uploadsLoadPromise;
    }

    function renderUploads() {
      const tbody = document.getElementById('uploadTableBody');
      const empty = document.getElementById('uploadEmpty');
      const rows = [];
      uploadsData.forEach(u => {
        (u.files || []).forEach(f => { rows.push({ ...u, fileName: f }); });
      });
      if (rows.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
      empty.style.display = 'none';
      tbody.innerHTML = rows.map(r => `
        <tr>
          <td>${escapeHtml(r.name)}</td>
          <td>${escapeHtml(r.studentId)}</td>
          <td><a class="file-link" href="/api/uploads/${encodeURIComponent(r.id)}/${r.fileName}" target="_blank">${decodeURIComponent(r.fileName)}</a></td>
          <td>${new Date(r.uploadedAt).toLocaleString('zh-CN')}</td>
          <td>
            <a class="btn btn-primary btn-small" style="text-decoration:none;" href="/api/uploads/${encodeURIComponent(r.id)}/${r.fileName}" download>下载</a>
            <button class="btn btn-danger btn-small" onclick="deleteUpload(this, '${r.id}')">删除记录</button>
          </td>
        </tr>
      `).join('');
    }

    async function deleteUpload(btn, id) {
      showConfirm('确认删除', '删除该上传记录后，该学生可以重新提交。确定要删除吗？', '确定', '取消', async function (confirmed) {
        if (!confirmed) return;
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

    async function downloadAllZip(btn) {
      if (zipDownloading || messageSending) return;
      zipDownloading = true;
      btn.disabled = true;
      reportProgress({type:'start', title:'正在准备打包下载…', detail:'正在整理文件清单', indeterminate:true});
      try {
        // If file list hasn't finished initial loading, wait for that same request.
        if (!uploadsFetchedAt) await loadUploads();
        if (!window.JSZip) {
          reportProgress({type:'update', title:'正在加载打包组件…', detail:'首次使用需要初始化 ZIP 组件', indeterminate:true});
          await window.__loadScript('/vendor/jszip.min.js');
        }
        if (!window.JSZip) throw new Error('打包组件加载失败');
        const jobs = [];
        for (const [idx, upload] of uploadsData.entries()) {
          const name = String(upload.name || '学生').replace(/[\\/\x00-\x1f<>:"|?*]/g, '_').slice(0, 50);
          const sid = String(upload.studentId ?? '').replace(/[\\/\x00-\x1f<>:"|?*]/g, '_').slice(0, 40);
          const folderName = `${name}_${sid}` || `上传_${idx}`;
          for (const [fileIdx, fileName] of (upload.files || []).entries()) {
            const sourceName = String(fileName);
            let displayName;
            try { displayName = decodeURIComponent(sourceName); } catch { displayName = sourceName; }
            displayName = displayName.replace(/[\\/\x00-\x1f]/g, '_').slice(0, 150) || `附件_${fileIdx+1}`;
            jobs.push({url:`/api/uploads/${encodeURIComponent(upload.id)}/${encodeURIComponent(sourceName)}`,
              folderName, displayName, fileIdx, recordIndex:idx});
          }
        }
        if (!jobs.length) throw new Error('当前没有可下载的文件');
        const zip = new JSZip();
        let next = 0, complete = 0, success = 0, failed = 0;
        reportProgress({type:'update', title:'正在并发下载文件…', percent:0,
          detail:`共 ${jobs.length} 个文件，最多 5 个并发连接`});
        // Limited concurrency is faster than sequential downloads and reduces
        // pressure on the Cloudflare->Gitee proxy compared to unbounded Promise.all.
        async function worker() {
          while (next < jobs.length) {
            const job = jobs[next++];
            try {
              const response = await fetch(job.url);
              if (!response.ok) throw new Error(`文件请求失败：HTTP ${response.status}`);
              const buffer = await response.arrayBuffer();
              zip.folder(job.folderName).file(`${job.recordIndex+1}_${job.fileIdx+1}_${job.displayName}`, buffer, {binary:true, compression:'STORE'});
              success++;
            } catch(e) { failed++; console.warn('[ZIP download]', job.url, e); }
            complete++;
            reportProgress({type:'update', title:'正在并发下载文件…',
              percent:complete / jobs.length * 80,
              detail:`已获取 ${complete}/${jobs.length} 个文件 · 成功 ${success} · 失败 ${failed}`});
          }
        }
        await Promise.all(Array.from({length:Math.min(5, jobs.length)}, worker));
        if (!success) throw new Error('文件全部下载失败，请检查网络或 Gitee 文件状态');
        reportProgress({type:'update', title:'正在生成 ZIP 压缩包…', percent:80,
          detail:`正在打包 ${success} 个文件${failed ? `，跳过 ${failed} 个失败文件` : ''}`});
        const content = await zip.generateAsync({type:'blob', compression:'STORE', streamFiles:true}, metadata => {
          reportProgress({type:'update', percent:80 + metadata.percent * .19,
            detail:`压缩包生成中 ${Math.round(metadata.percent)}% · ${success} 个文件`});
        });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url; a.download = `uploads_${Date.now()}.zip`;
        document.body.appendChild(a); a.click(); a.remove();
        // Keep the object URL valid while browsers start the download.
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        reportProgress({type:failed ? 'error':'success',
          title:failed ? '打包完成，但有文件未下载':'打包下载已开始',
          detail:`已打包 ${success} 个文件${failed ? `，另有 ${failed} 个文件未获取。下载内容可能不完整。`: '。浏览器正在保存 ZIP 文件。'}`});
      } catch(e) {
        reportProgress({type:'error', title:'打包下载失败', detail:e.message || '下载或打包过程中发生错误'});
      } finally { zipDownloading = false; btn.disabled = false; }
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
      }
    } catch {}

    function setSubmissionSyncStatus(label) {
      const el = document.getElementById('submissionSyncState');
      if (el) el.textContent = label;
      const updated = document.getElementById('submissionUpdatedAt');
      if (updated) updated.textContent = submissionUpdatedAt ? `列表快照：${new Date(submissionUpdatedAt).toLocaleTimeString('zh-CN')}` : '';
    }

    function updateSubmissionSnapshot(studentsList, uploads) {
      if (!Array.isArray(studentsList) || !Array.isArray(uploads)) return;
      const grouped = new Map();
      for (const u of uploads) {
        const sid = String(u.studentId ?? '');
        if (!grouped.has(sid)) grouped.set(sid, {name:u.name||'', studentId:sid, count:0, lastTime:0, fileCount:0});
        const row = grouped.get(sid);
        row.count++;
        const time = typeof u.uploadedAt === 'number' ? u.uploadedAt : Date.parse(u.uploadedAt) || 0;
        row.lastTime = Math.max(row.lastTime, time);
        row.fileCount += Array.isArray(u.files) ? u.files.length : 0;
      }
      submissionData = {
        submitted:[...grouped.values()],
        notSubmitted:studentsList.filter(st => !grouped.has(String(st.studentId ?? '')))
          .map(st => ({name:st.name||'', studentId:String(st.studentId??'')}))
      };
      submissionReady = true;
      submissionUpdatedAt = Date.now();
      try { sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify({...submissionData,updatedAt:submissionUpdatedAt})); } catch {}
      if (document.getElementById('submissionModal')?.classList.contains('show')) {
        renderSubmissionTable();
        setSubmissionSyncStatus('列表已更新 · 每 8 秒自动检查');
      }
    }

    function openSubmissionModal() {
      const modal = document.getElementById('submissionModal');
      modal.classList.add('show'); // synchronous: no waiting for Gitee requests
      renderSubmissionTable();
      setSubmissionSyncStatus(submissionReady ? '显示已有列表，后台同步中…' : '正在获取首次列表…');
      // Requests start after the browser has a chance to paint the modal.
      requestAnimationFrame(() => { void refreshSubmissionData(); });
      if (submissionAutoRefreshTimer) clearInterval(submissionAutoRefreshTimer);
      submissionAutoRefreshTimer = setInterval(() => {
        if (modal.classList.contains('show')) void refreshSubmissionData();
      }, 8000);
    }

    function closeSubmissionModal() {
      document.getElementById('submissionModal').classList.remove('show');
      if (submissionAutoRefreshTimer) { clearInterval(submissionAutoRefreshTimer); submissionAutoRefreshTimer = null; }
    }

    function refreshSubmissionData(manual = false) {
      if (submissionRefreshPromise) return submissionRefreshPromise;
      setSubmissionSyncStatus(submissionReady ? '正在同步最新数据…' : '正在获取首次列表…');
      submissionRefreshPromise = (async () => {
        try {
          const now = Date.now();
          const [studentsList, uploads] = await Promise.all([
            (!manual && studentsFetchedAt && now - studentsFetchedAt < 15000)
              ? Promise.resolve(students)
              : apiCache.get('/api/students', {ttl:15000,force:!!manual,fetchOpts:{headers:authHeader}}),
            (!manual && uploadsFetchedAt && now - uploadsFetchedAt < 8000)
              ? Promise.resolve(uploadsData)
              : (uploadsLoadPromise ? uploadsLoadPromise.then(()=>uploadsData) :
                apiCache.get('/api/files', {ttl:8000, force:!!manual, fetchOpts:{headers:authHeader}}))
          ]);
          students = studentsList; studentsFetchedAt = Date.now();
          uploadsData = uploads; uploadsFetchedAt = Date.now();
          updateSubmissionSnapshot(studentsList, uploads);
        } catch(e) {
          console.warn('[submission status refresh]',e);
          setSubmissionSyncStatus(submissionReady ? '同步失败 · 正在显示上次列表' : '加载失败，请点击刷新重试');
          if (manual) throw e;
        }
      })().finally(() => {submissionRefreshPromise = null;});
      return submissionRefreshPromise;
    }

    function switchSubmissionTab(tab) {
      currentSubmissionTab = tab;
      document.getElementById('tabSubmittedBtn').classList.toggle('active', tab === 'submitted');
      document.getElementById('tabNotSubmittedBtn').classList.toggle('active', tab === 'notSubmitted');
      renderSubmissionTable();
    }

    function renderSubmissionTable() {
      const thead = document.getElementById('submissionThead');
      const tbody = document.getElementById('submissionTbody');
      const empty = document.getElementById('submissionEmpty');
      if (!submissionReady) {
        thead.innerHTML = '<tr><th>提交状态</th></tr>';
        tbody.innerHTML = '<tr><td class="empty-state">正在加载学生及上传记录，请稍候…</td></tr>';
        empty.style.display = 'none';
        document.getElementById('submittedCount').textContent = '…';
        document.getElementById('notSubmittedCount').textContent = '…';
        return;
      }
      document.getElementById('submittedCount').textContent = submissionData.submitted.length;
      document.getElementById('notSubmittedCount').textContent = submissionData.notSubmitted.length;
      if (currentSubmissionTab === 'submitted') {
        thead.innerHTML = '<tr><th>姓名</th><th>学号</th><th>提交次数</th><th>文件数</th><th>最近提交</th></tr>';
        if (submissionData.submitted.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
        empty.style.display = 'none';
        tbody.innerHTML = submissionData.submitted.map(s => `
          <tr>
            <td>${escapeHtml(s.name)}</td>
            <td>${escapeHtml(s.studentId)}</td>
            <td>${s.count}</td>
            <td>${s.fileCount}</td>
            <td>${new Date(s.lastTime).toLocaleString('zh-CN')}</td>
          </tr>
        `).join('');
      } else {
        thead.innerHTML = '<tr><th>姓名</th><th>学号</th></tr>';
        if (submissionData.notSubmitted.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
        empty.style.display = 'none';
        tbody.innerHTML = submissionData.notSubmitted.map(s => `
          <tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.studentId)}</td></tr>
        `).join('');
      }
    }

    function exportSubmissionExcel(btn) {
      let data, sheetName, fileName;
      if (currentSubmissionTab === 'submitted') {
        data = submissionData.submitted.map(s => ({
          姓名: s.name, 学号: s.studentId, 提交次数: s.count, 文件数: s.fileCount,
          最近提交: new Date(s.lastTime).toLocaleString('zh-CN'),
        }));
        sheetName = '已交名单'; fileName = `已交名单_${Date.now()}.xlsx`;
      } else {
        data = submissionData.notSubmitted.map(s => ({ 姓名: s.name, 学号: s.studentId }));
        sheetName = '未交名单'; fileName = `未交名单_${Date.now()}.xlsx`;
      }
      if (!submissionReady || data.length === 0) { flashError('当前没有可导出的数据'); return; }
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      XLSX.writeFile(wb, fileName);
      flashSuccess(`已导出 ${data.length} 条记录`);
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
