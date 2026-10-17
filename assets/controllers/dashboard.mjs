/** Vue 3 page controller — dashboard.
 * Mounted by the Vue PageContent component; API operations remain unchanged.
 * Business DOM fragments from the pre-Vue project are preserved for compatibility.
 */
export function mount() {

    const token = localStorage.getItem('adminToken');
    const user = JSON.parse(localStorage.getItem('adminUser') || '{}');
    const authHeader = { 'Authorization': `Bearer ${token}` };

    /* 结合边缘缓存后的 TTL */
    const TTL = {
      permissions: 60000,
      apps: 5000,
      students: 15000,
    };

    if (user.role === 'system') {
      // 系统管理已统一放到 Vue 侧边栏，不再依赖旧版跨页按钮。
    }

    let currentUserCanBan = false;
    let currentUserCanAudit = false;
    let allApps = [];
    let students = [];
    let currentModalAppId = null;

    function escapeHtml(str) {
      const d = document.createElement('div');
      d.textContent = str;
      return d.innerHTML;
    }

    /* ============================================
       权限
       ============================================ */
    async function loadMyPermissions() {
      try {
        const data = await apiCache.get('/api/admin?action=my-permissions', {
          ttl: TTL.permissions,
          fetchOpts: { headers: authHeader }
        });
        currentUserCanBan = data.canBan === true;
        currentUserCanAudit = data.auditPermission === true || data.auditPermission === 1;
      } catch (e) {
        currentUserCanBan = false;
        currentUserCanAudit = false;
      }
      updatePermissionUI();
      const storedUser = JSON.parse(localStorage.getItem('adminUser') || '{}');
      storedUser.canBan = currentUserCanBan;
      storedUser.auditPermission = currentUserCanAudit ? 1 : 0;
      localStorage.setItem('adminUser', JSON.stringify(storedUser));
    }

    function updatePermissionUI() {
      const auditBadge = document.getElementById('auditPermBadge');
      const banBadge = document.getElementById('banPermBadge');

      if (currentUserCanAudit) {
        auditBadge.textContent = '已开启';
        auditBadge.className = 'permission-badge allowed';
      } else {
        auditBadge.textContent = '未开启';
        auditBadge.className = 'permission-badge denied';
      }
      if (banBadge && currentUserCanBan) {
        banBadge.textContent = '已开启';
        banBadge.className = 'permission-badge allowed';
      } else if (banBadge) {
        banBadge.textContent = '未开启';
        banBadge.className = 'permission-badge denied';
      }

      const studentTab = document.getElementById('studentTab');
      if (studentTab) studentTab.style.display = currentUserCanBan && user.role !== 'system' ? 'inline-flex' : 'none';
    }

    /* ============================================
       Tab 切换
       ============================================ */
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        if (this.classList.contains('active')) return;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        const tab = this.dataset.tab;
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
        document.getElementById('tab-' + tab).classList.add('active');
        renderTab(tab);
      });
    });

    function renderTab(tab) {
      if (tab === 'pending' || tab === 'approved') renderAuditTab(tab);
      else if (tab === 'students') renderStudentTab();
    }

    const ARROW_SVG = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`;

    /* ============================================
       审核列表
       ============================================ */
    function renderAuditTab(tab) {
      const container = document.getElementById('tab-' + tab);
      let apps;
      if (tab === 'pending') apps = allApps.filter(a => a.status === 'pending');
      else if (tab === 'approved') apps = allApps.filter(a => a.status === 'approved');

      if (!apps || apps.length === 0) {
        container.innerHTML = `<div class="empty">暂无${tab === 'pending' ? '待审核' : '已审核'}申请</div>`;
        return;
      }

      if (tab === 'pending') {
        container.innerHTML = `<div class="app-list">` + apps.map(app => `
          <div class="app-item" onclick="openAuditModal('${app.id}')">
            <div class="info">
              <strong>${escapeHtml(app.name)}</strong> <span class="sub">学号：${escapeHtml(app.packageName)}</span>
              <div class="sub">活动：${escapeHtml(app.versionName)} ｜ 时间：${escapeHtml(app.publisher || '')}</div>
              ${app.participants ? `<div class="sub">参与名单：${escapeHtml(app.participants)}</div>` : ''}
            </div>
            <div class="arrow">${ARROW_SVG}</div>
          </div>
        `).join('') + `</div>`;
      } else {
        container.innerHTML = `
          <div class="toolbar">
            <button class="btn btn-danger" onclick="deleteSelected(this)">删除选中</button>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="checkbox" id="selectAllApproved" onchange="toggleAllApproved()"> 全选
            </label>
            <span style="color:#718096;font-size:14px;">已选 <span id="selectedApprovedCount">0</span> 条</span>
          </div>
          <div class="app-list">
            ${apps.map(app => `
              <div class="app-item" data-id="${app.id}" onclick="event.stopPropagation();">
                <div class="info" style="display:flex;align-items:flex-start;gap:10px;">
                  <input type="checkbox" class="checkbox approved-checkbox" value="${app.id}" onchange="updateSelectedCount()" onclick="event.stopPropagation();" style="margin-top:4px;" />
                  <div style="flex:1;">
                    <strong>${escapeHtml(app.name)}</strong> <span class="sub">学号：${escapeHtml(app.packageName)}</span>
                    <div class="sub">活动：${escapeHtml(app.versionName)} ｜ 时间：${escapeHtml(app.publisher || '')}</div>
                    ${app.participants ? `<div class="sub">参与名单：${escapeHtml(app.participants)}</div>` : ''}
                  </div>
                </div>
                <div class="actions">
                  <button class="btn btn-primary" onclick="event.stopPropagation(); openAuditModal('${app.id}', true)">查看</button>
                </div>
              </div>
            `).join('')}
          </div>
        `;
        updateSelectedCount();
      }
    }

    /* ============================================
       审核弹窗
       ============================================ */
    function openAuditModal(id, isApproved = false) {
      const app = allApps.find(a => a.id === id);
      if (!app) return;
      currentModalAppId = id;

      const card = document.getElementById('auditModalCard');
      const screenshotsHTML = (app.screenshots || []).map(f =>
        `<div class="img-wrapper" onclick="viewImage('/api/screenshots/${encodeURIComponent(app.id)}/${f}')">
          <img src="/api/screenshots/${encodeURIComponent(app.id)}/${f}" onerror="this.style.display='none'; this.parentElement.innerHTML='<div class=\\'placeholder\\'>图片加载失败</div>';" />
        </div>`
      ).join('');

      let actionButtons = '';
      if (isApproved) {
        actionButtons = `<button class="btn btn-skip" onclick="closeAuditModal()">关闭</button>`;
      } else if (currentUserCanAudit) {
        actionButtons = `
          <button class="btn btn-approve" onclick="modalApprove()">通过</button>
          <button class="btn btn-needs-fix" onclick="modalNeedsFix()">驳回修改</button>
          <button class="btn btn-reject" onclick="modalReject()">不通过</button>`;
      } else {
        actionButtons = `
          <div style="width:100%;text-align:center;color:#991b1b;padding:10px;background:#fef2f2;border-radius:12px;font-weight:600;">您没有审核权限</div>
          <button class="btn btn-skip" onclick="closeAuditModal()">关闭</button>`;
      }

      card.innerHTML = `
        <div class="audit-modal-header">
          <h2>${escapeHtml(app.versionName || '未命名活动')}</h2>
          <button class="audit-modal-close" onclick="closeAuditModal()">×</button>
        </div>

        <div class="audit-modal-section">
          <div class="label">申请人</div>
          <div class="value">${escapeHtml(app.name || '未知')} · 学号：${escapeHtml(app.packageName || '')}</div>
        </div>

        <div class="audit-modal-section">
          <div class="label">活动时间</div>
          <div class="value">${escapeHtml(app.publisher || '')}</div>
        </div>

        ${app.participants ? `
        <div class="audit-modal-section">
          <div class="label">活动参与名单</div>
          <div class="value">${escapeHtml(app.participants)}</div>
        </div>` : ''}

        ${app.rejectReason ? `
        <div class="audit-modal-section">
          <div class="label">驳回原因</div>
          <div class="value" style="color:#991b1b;">${escapeHtml(app.rejectReason)}</div>
        </div>` : ''}

        ${screenshotsHTML ? `
        <div class="audit-modal-section">
          <div class="label">证明截图</div>
          <div class="audit-modal-images">${screenshotsHTML}</div>
        </div>` : ''}

        <div class="audit-modal-actions">
          ${actionButtons}
        </div>
      `;

      document.getElementById('auditModalOverlay').classList.add('show');
    }

    function closeAuditModal() {
      document.getElementById('auditModalOverlay').classList.remove('show');
      currentModalAppId = null;
    }

    document.getElementById('auditModalOverlay').addEventListener('click', function (e) {
      if (e.target === this) closeAuditModal();
    });

    /* ============================================
       审核操作触发
       ============================================ */
    function modalApprove() {
      if (!currentModalAppId) return;
      if (!currentUserCanAudit) { flashError('您没有审核权限'); return; }
      const id = currentModalAppId;
      closeAuditModal();
      auditAction(id, 'approve');
    }

    function modalNeedsFix() {
      if (!currentModalAppId) return;
      if (!currentUserCanAudit) { flashError('您没有审核权限'); return; }
      const id = currentModalAppId;
      showPrompt(
        '驳回修改',
        '请填写驳回修改原因（将发送给申请人，申请将保留在"需要修改的学分"中）：',
        '',
        '如：证明材料不清晰，请重新上传',
        '确定', '取消',
        function (reason) {
          if (reason === null) return;
          if (!reason.trim()) { flashError('请填写驳回修改原因'); return; }
          closeAuditModal();
          auditAction(id, 'needs_fix', null, reason.trim());
        }
      );
    }

    function modalReject() {
      if (!currentModalAppId) return;
      if (!currentUserCanAudit) { flashError('您没有审核权限'); return; }
      const id = currentModalAppId;
      showPrompt(
        '不通过',
        '请填写不通过原因（将发送给申请人，同时该申请将被永久删除）：',
        '',
        '如：不符合申请条件',
        '确定删除', '取消',
        function (reason) {
          if (reason === null) return;
          if (!reason.trim()) { flashError('请填写不通过原因'); return; }
          showConfirm(
            '二次确认',
            '确定不通过并删除该申请吗？此操作不可恢复。',
            '确定删除', '取消',
            function (confirmed) {
              if (!confirmed) return;
              closeAuditModal();
              auditAction(id, 'reject', null, reason.trim());
            }
          );
        }
      );
    }

    function viewImage(src) {
      const modal = document.createElement('div');
      modal.className = 'image-viewer-modal';
      const img = document.createElement('img');
      img.src = src;
      modal.appendChild(img);
      modal.onclick = () => modal.remove();
      document.body.appendChild(modal);
    }

    /* ============================================
       审核操作：全屏加载遮罩
       通过 → "正在通过..."
       驳回 → "正在驳回活动..."
       不通过 → "正在处理不通过活动..."
       ============================================ */
    async function auditAction(id, action, modifications = null, rejectReason = null) {
      if (!currentUserCanAudit) {
        flashError('您没有审核权限，请联系系统管理员授予。');
        return;
      }

      const overlayMessage =
        action === 'approve'   ? '正在通过...' :
        action === 'needs_fix' ? '正在驳回活动...' :
        action === 'reject'    ? '正在处理不通过活动...' :
        '正在处理...';

      const body = { id, action };
      if (action === 'modify' && modifications) body.modifications = modifications;
      if (action === 'reject' || action === 'needs_fix') body.rejectReason = rejectReason;

      const run = async () => {
        try {
          const res = await fetch('/api/audit', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...authHeader },
            body: JSON.stringify(body)
          });

          if (!res.ok) {
            let errMsg = '操作失败';
            try { errMsg = (await res.json()).error || errMsg; } catch (e) {}
            flashError(errMsg);
          } else {
            if (action === 'approve') flashSuccess('已通过');
            else if (action === 'needs_fix') flashSuccess('已驳回，等待修改');
            else if (action === 'reject') flashSuccess('已不通过并删除');
          }

          apiCache.invalidate('/api/apps');
          // 广播给其他标签页
          if (window.syncBus) syncBus.emit('apps', { action, id });
          setTimeout(() => loadAllApps(true), 300);
        } catch (e) {
          console.error('审核请求异常:', e);
          apiCache.invalidate('/api/apps');
          setTimeout(() => loadAllApps(true), 1500);
        }
      };

      if (window.withOverlay) {
        await window.withOverlay(overlayMessage, run, 600);
      } else {
        await run();
      }
    }

    /* ============================================
       已审核：批量删除
       ============================================ */
    function toggleAllApproved() {
      const checked = document.getElementById('selectAllApproved').checked;
      document.querySelectorAll('.approved-checkbox').forEach(cb => cb.checked = checked);
      updateSelectedCount();
    }

    function updateSelectedCount() {
      const checked = document.querySelectorAll('.approved-checkbox:checked').length;
      const el = document.getElementById('selectedApprovedCount');
      if (el) el.textContent = checked;
      const total = document.querySelectorAll('.approved-checkbox').length;
      const allChecked = total > 0 && checked === total;
      const selectAll = document.getElementById('selectAllApproved');
      if (selectAll) selectAll.checked = allChecked;
    }

    async function deleteSelected(btn) {
      const checked = document.querySelectorAll('.approved-checkbox:checked');
      if (checked.length === 0) { flashError('请至少选择一个申请'); return; }
      showConfirm(
        '确认删除',
        `确定要永久删除选中的 ${checked.length} 个申请吗？`,
        '确定', '取消',
        async function (confirmed) {
          if (!confirmed) return;
          const ids = Array.from(checked).map(cb => cb.value);
          await withLoading(btn, async () => {
            try {
              const res = await fetch('/api/apps', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json', ...authHeader },
                body: JSON.stringify({ ids })
              });
              if (!res.ok) {
                const err = await res.json();
                flashError(err.error || '删除失败');
                return;
              }
              flashSuccess(`已删除 ${ids.length} 个申请`);
              apiCache.invalidate('/api/apps');
              if (window.syncBus) syncBus.emit('apps', { action: 'delete', ids });
              loadAllApps(true);
            } catch (e) {
              flashError('网络错误');
            }
          });
        }
      );
    }

    /* ============================================
       学生管理
       ============================================ */
    function renderStudentTab() {
      const container = document.getElementById('tab-students');
      if (!container || user.role === 'system') return;
      if (!currentUserCanBan) {
        container.innerHTML = `<div class="empty">您没有封禁权限</div>`;
        return;
      }
      container.innerHTML = `
        <div style="background:#fff;border-radius:20px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,0.04);">
          <h2 style="font-size:20px;font-weight:600;margin-bottom:16px;">学生名单（可封禁/解封）</h2>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;">
              <thead><tr>
                <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #edf2f7;background:#f8fafc;">姓名</th>
                <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #edf2f7;background:#f8fafc;">学号</th>
                <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #edf2f7;background:#f8fafc;">状态</th>
                <th style="padding:10px 12px;text-align:left;border-bottom:1px solid #edf2f7;background:#f8fafc;">操作</th>
              </tr></thead>
              <tbody id="studentTableBody"></tbody>
            </table>
          </div>
          <div id="studentEmpty" style="text-align:center;padding:30px 20px;color:#6b7a8f;display:none;">暂无学生数据</div>
        </div>
      `;
      renderStudentTable();
    }

    async function loadStudents(force = false) {
      try {
        students = await apiCache.get('/api/students', {
          ttl: TTL.students,
          force,
          fetchOpts: { headers: authHeader }
        });
        if (document.querySelector('.tab-btn.active')?.dataset.tab === 'students') {
          renderStudentTable();
        }
      } catch (e) { console.error(e); }
    }

    function renderStudentTable() {
      const tbody = document.getElementById('studentTableBody');
      const empty = document.getElementById('studentEmpty');
      if (!tbody) return;

      if (students.length === 0) {
        tbody.innerHTML = '';
        if (empty) empty.style.display = 'block';
        return;
      }
      if (empty) empty.style.display = 'none';

      tbody.innerHTML = students.map(s => {
        const isBanned = s.banned || false;
        const statusBadge = isBanned
          ? '<span style="padding:2px 10px;border-radius:20px;font-size:12px;font-weight:600;background:#f8d7da;color:#721c24;">已封禁</span>'
          : '<span style="padding:2px 10px;border-radius:20px;font-size:12px;font-weight:600;background:#d4edda;color:#155724;">正常</span>';

        const banButton = currentUserCanBan
          ? `<button class="btn btn-danger" style="padding:5px 14px;font-size:13px;" onclick="toggleBan(this, '${escapeHtml(s.studentId)}', ${isBanned})">${isBanned ? '解封' : '封禁'}</button>`
          : '<span style="color:#6b7280;font-size:12px;">无权限</span>';

        return `<tr data-sid="${escapeHtml(s.studentId)}">
          <td style="padding:10px 12px;border-bottom:1px solid #edf2f7;">${escapeHtml(s.name)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #edf2f7;">${escapeHtml(s.studentId)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #edf2f7;">${statusBadge}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #edf2f7;">${banButton}</td>
        </tr>`;
      }).join('');
    }

    async function toggleBan(btn, studentId, currentBanned) {
      if (!currentUserCanBan) { flashError('您没有封禁权限'); return; }
      showConfirm(
        '确认操作',
        `确定要${currentBanned ? '解封' : '封禁'}该学生吗？`,
        '确定', '取消',
        async function (confirmed) {
          if (!confirmed) return;
          const newVal = !currentBanned;
          const student = students.find(s => s.studentId === studentId);
          if (student) student.banned = newVal;
          renderStudentTable();

          try {
            const res = await fetch('/api/students', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', ...authHeader },
              body: JSON.stringify({ studentId, banned: newVal })
            });
            if (!res.ok) {
              const err = await res.json();
              if (student) student.banned = currentBanned;
              renderStudentTable();
              flashError(err.error || '操作失败');
            } else {
              const row = document.querySelector(`tr[data-sid="${studentId}"]`);
              pulseElement(row, 'success');
              flashSuccess(newVal ? '已封禁' : '已解封');
              apiCache.invalidate('/api/students');
              if (window.syncBus) syncBus.emit('students', { action: 'ban', studentId });
            }
          } catch (e) {
            if (student) student.banned = currentBanned;
            renderStudentTable();
            flashError('网络错误');
          }
        }
      );
    }

    /* ============================================
       加载应用列表
       ============================================ */
    async function loadAllApps(force = false) {
      try {
        const apps = await apiCache.get('/api/apps', {
          ttl: TTL.apps,
          force,
          fetchOpts: { headers: authHeader }
        });
        allApps = apps;
        const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab || 'pending';
        renderTab(activeTab);
        ['pending', 'approved'].forEach(t => {
          if (t !== activeTab) renderTab(t);
        });
      } catch (e) {
        document.getElementById('tab-pending').innerHTML = `<div class="empty" style="color:red">加载失败：${escapeHtml(e.message)}</div>`;
      }
    }

    /* ============================================
       跨标签页同步
       ============================================ */
    if (window.syncBus) {
      syncBus.on('apps', function () {
        apiCache.invalidate('/api/apps');
        loadAllApps(true);
      });
      syncBus.on('students', function () {
        apiCache.invalidate('/api/students');
        loadStudents(true);
      });
    }

    /* ============================================
       退出
       ============================================ */
    function logout() {
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminUser');
      apiCache.clear();
      
      setTimeout(() => { window.location.href = '/login.html'; }, 180);
    }

    /* ============================================
       初始化
       ============================================ */
    async function init() {
      await Promise.all([
        loadMyPermissions(),
        loadAllApps()
      ]);
      if (currentUserCanBan && user.role !== 'system') loadStudents();
    }
    init();
  
    window.escapeHtml = escapeHtml;
    window.loadMyPermissions = loadMyPermissions;
    window.updatePermissionUI = updatePermissionUI;
    window.renderTab = renderTab;
    window.renderAuditTab = renderAuditTab;
    window.openAuditModal = openAuditModal;
    window.closeAuditModal = closeAuditModal;
    window.modalApprove = modalApprove;
    window.modalNeedsFix = modalNeedsFix;
    window.modalReject = modalReject;
    window.viewImage = viewImage;
    window.auditAction = auditAction;
    window.toggleAllApproved = toggleAllApproved;
    window.updateSelectedCount = updateSelectedCount;
    window.deleteSelected = deleteSelected;
    window.renderStudentTab = renderStudentTab;
    window.loadStudents = loadStudents;
    window.renderStudentTable = renderStudentTable;
    window.toggleBan = toggleBan;
    window.loadAllApps = loadAllApps;
    window.logout = logout;
    window.init = init;

}
