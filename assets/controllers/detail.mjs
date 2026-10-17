/** Vue 3 page controller — detail.
 * Mounted by the Vue PageContent component; API operations remain unchanged.
 * Business DOM fragments from the pre-Vue project are preserved for compatibility.
 */
export function mount() {

    const token = localStorage.getItem('studentToken');
    let user = {};
    try { user = JSON.parse(localStorage.getItem('studentUser') || '{}') || {}; } catch (_) {}

    let currentApp = null;
    let isOwner = false;
    let newScreenshots = [];   // 用户新上传的截图（替换原图用）
    let editPending = false;
    let cancelPending = false;
    let cancelProgressDialog = null;

    function setEditActionsDisabled(disabled) {
      for (const id of ['btnSubmitEdit', 'btnCancelApp']) {
        const button = document.getElementById(id);
        if (button) button.disabled = disabled;
      }
      const form = document.getElementById('editForm');
      if (form) form.setAttribute('aria-busy', String(disabled));
    }

    // 防止网络取消请求完成前用户误关页面。浏览器/操作系统仍可能强制终止标签页。
    function preventLeaveWhileCancelling(event) {
      if (!cancelPending) return;
      event.preventDefault();
      event.returnValue = '';
    }

    // 仅在确认取消后展示；没有关闭按钮，不接受 Esc/点击遮罩关闭。
    function showCancelProgress() {
      if (cancelProgressDialog) return;
      const overlay = document.createElement('div');
      overlay.id = 'cancelApplicationProgress';
      overlay.className = 'cancel-progress-backdrop';
      overlay.setAttribute('role', 'alertdialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'cancelProgressTitle');
      overlay.setAttribute('aria-describedby', 'cancelProgressHint');
      overlay.innerHTML = `
        <div class="cancel-progress-card" tabindex="-1">
          <span class="cancel-progress-spinner" aria-hidden="true"></span>
          <h2 id="cancelProgressTitle">正在取消申请...</h2>
          <p id="cancelProgressHint">请勿关闭或返回页面，正在等待服务器确认取消结果。</p>
        </div>`;
      const host = document.getElementById('app');
      const previousInert = host ? host.inert : false;
      if (host) host.inert = true;
      document.body.appendChild(overlay);
      const oldOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      overlay.querySelector('.cancel-progress-card').focus({ preventScroll: true });
      cancelProgressDialog = () => {
        overlay.remove();
        if (host) host.inert = previousInert;
        document.body.style.overflow = oldOverflow;
        cancelProgressDialog = null;
      };
    }

    function endCancelProgress() {
      window.removeEventListener('beforeunload', preventLeaveWhileCancelling);
      if (cancelProgressDialog) cancelProgressDialog();
      cancelPending = false;
      setEditActionsDisabled(false);
    }

    function escapeHtml(str) {
      const d = document.createElement('div');
      d.textContent = str;
      return d.innerHTML;
    }

    /* ============================================
       图片查看器
       ============================================ */
    function showImageModal(src) {
      const modal = document.createElement('div');
      modal.className = 'image-modal';
      const img = document.createElement('img');
      img.src = src;
      modal.appendChild(img);
      modal.onclick = () => modal.remove();
      document.body.appendChild(modal);
    }

    function loadImageWithRetry(img, src, maxRetries = 2) {
      let attempts = 0;
      const tryLoad = () => {
        attempts++;
        const sep = src.includes('?') ? '&' : '?';
        img.src = src + sep + 'retry=' + attempts + '&t=' + Date.now();
      };
      img.onerror = () => {
        if (attempts < maxRetries) {
          setTimeout(tryLoad, 1000);
        } else {
          img.style.display = 'none';
          const wrapper = img.parentElement;
          const placeholder = document.createElement('div');
          placeholder.className = 'placeholder';
          placeholder.innerHTML = `
            <span>加载失败</span>
            <button onclick="this.parentElement.parentElement.querySelector('img').style.display='block'; this.parentElement.remove(); loadImageWithRetry(this.parentElement.parentElement.querySelector('img'), '${src}', 3)">重试</button>
          `;
          wrapper.appendChild(placeholder);
        }
      };
      tryLoad();
    }

    /* ============================================
       图片压缩
       ============================================ */
    function compressImage(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width, height = img.height;
            const MAX = 700;
            if (width > height) { if (width > MAX) { height *= MAX / width; width = MAX; } }
            else { if (height > MAX) { width *= MAX / height; height = MAX; } }
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob(blob => {
              if (!blob) return reject(new Error('压缩失败'));
              resolve(new File([blob], file.name, { type: 'image/jpeg' }));
            }, 'image/jpeg', 0.5);
          };
          img.onerror = reject;
          img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    /* ============================================
       时间格式转换
       "2025-01-15 14:00"  <->  "2025-01-15T14:00"
       ============================================ */
    function toDatetimeLocal(publisher) {
      if (!publisher) return '';
      // 兼容旧数据：可能为 "2025-01-15 14:00" 或 "2025-01-15T14:00"
      return String(publisher).replace(' ', 'T').slice(0, 16);
    }
    function fromDatetimeLocal(val) {
      if (!val) return '';
      return String(val).replace('T', ' ');
    }

    /* ============================================
       状态标签
       ============================================ */
    function getStatusTag(status) {
      if (status === 'needs_fix') return '<span class="tag needs-fix">需要修改</span>';
      if (status === 'approved') return '<span class="tag approved">已通过</span>';
      if (status === 'pending') return '<span class="tag pending">待审核</span>';
      return '';
    }

    /* ============================================
       只读详情渲染（不需要修改时）
       ============================================ */
    function renderReadonlyDetail(app) {
      const container = document.getElementById('detailContent');
      container.innerHTML = '';

      const header = document.createElement('div');
      header.className = 'detail-header';
      header.innerHTML = `
        <h2>${escapeHtml(app.versionName || '未命名活动')}</h2>
        <div class="sub">${escapeHtml(app.name || '未知')} · 学号：${escapeHtml(app.packageName || '')}</div>
      `;
      container.appendChild(header);

      const meta = document.createElement('div');
      meta.className = 'detail-meta';
      const tag = document.createElement('span');
      tag.className = 'tag time';
      tag.textContent = app.publisher || '';
      meta.appendChild(tag);
      const statusTagHTML = getStatusTag(app.status);
      if (statusTagHTML) {
        const span = document.createElement('span');
        span.innerHTML = statusTagHTML;
        meta.appendChild(span.firstElementChild);
      }
      container.appendChild(meta);

      if (app.participants) {
        const section = document.createElement('div');
        section.className = 'detail-section';
        section.innerHTML = `
          <h3>活动参与名单</h3>
          <div class="value">${escapeHtml(app.participants)}</div>
        `;
        container.appendChild(section);
      }

      if (app.rejectReason) {
        const section = document.createElement('div');
        section.className = 'detail-section reject-reason';
        section.innerHTML = `
          <h3>驳回原因</h3>
          <div class="value">${escapeHtml(app.rejectReason)}</div>
        `;
        container.appendChild(section);
      }

      if (app.screenshots && app.screenshots.length > 0) {
        const section = document.createElement('div');
        section.className = 'detail-section';
        const title = document.createElement('h3');
        title.textContent = '证明截图';
        section.appendChild(title);
        const imgContainer = document.createElement('div');
        imgContainer.className = 'screenshots';
        app.screenshots.forEach(f => {
          const wrapper = document.createElement('div');
          wrapper.className = 'img-wrapper';
          const img = document.createElement('img');
          const src = `/api/screenshots/${encodeURIComponent(app.id)}/${f}`;
          img.loading = 'lazy';
          img.onclick = (e) => { e.stopPropagation(); showImageModal(img.src); };
          wrapper.appendChild(img);
          imgContainer.appendChild(wrapper);
          loadImageWithRetry(img, src, 2);
        });
        section.appendChild(imgContainer);
        container.appendChild(section);
      }
    }

    /* ============================================
       编辑详情渲染（被驳回 + 本人）
       标题 / 时间 / 参与名单 直接是可编辑控件
       ============================================ */
    function renderEditableDetail(app) {
      const container = document.getElementById('detailContent');
      container.innerHTML = '';

      // 头部：只显示申请人信息（不可改）
      const header = document.createElement('div');
      header.className = 'detail-header';
      header.innerHTML = `
        <h2>修改申请</h2>
        <div class="sub">${escapeHtml(app.name || '未知')} · 学号：${escapeHtml(app.packageName || '')}</div>
      `;
      container.appendChild(header);

      // 状态标签
      const meta = document.createElement('div');
      meta.className = 'detail-meta';
      meta.innerHTML = '<span class="tag needs-fix">需要修改</span>';
      container.appendChild(meta);

      // 驳回原因
      if (app.rejectReason) {
        const section = document.createElement('div');
        section.className = 'detail-section reject-reason';
        section.innerHTML = `
          <h3>驳回原因</h3>
          <div class="value">${escapeHtml(app.rejectReason)}</div>
        `;
        container.appendChild(section);
      }

      // ===== 表单：直接展示可编辑控件 =====
      const form = document.createElement('form');
      form.id = 'editForm';
      form.className = 'edit-form';
      form.innerHTML = `
        <div class="form-group">
          <label>活动名称 <span class="required">*</span></label>
          <input type="text" class="form-control" id="editVersionName"
                 value="${escapeHtml(app.versionName || '')}"
                 placeholder="请输入活动名称" required />
        </div>

        <div class="form-group">
          <label>活动时间 <span class="required">*</span></label>
          <input type="datetime-local" class="form-control" id="editPublisher"
                 value="${toDatetimeLocal(app.publisher)}" required />
        </div>

        <div class="form-group">
          <label>活动参与名单</label>
          <textarea class="form-control" id="editParticipants" rows="3"
                    placeholder="例如：张三，李四，王五">${escapeHtml(app.participants || '')}</textarea>
          <div class="form-hint">如果是全班参加则填写"全班"</div>
        </div>

        <div class="form-group">
          <label>证明截图</label>
          <div class="screenshots" id="editCurrentScreenshots"></div>
          <div style="margin-top:14px;">
            <input type="file" id="editScreenshots" accept="image/*" multiple
                   style="padding:8px;border:2px dashed #e2e8f0;border-radius:14px;width:100%;font-family:inherit;font-size:14px;" />
            <div class="edit-preview" id="editPreview"></div>
          </div>
          <div class="form-hint">如不上传新图，将保留原截图；如需替换，请上传新图（最多 2 张）</div>
        </div>

        <div class="action-bar">
          <button type="submit" class="btn btn-primary" id="btnSubmitEdit">提交修改</button>
          <button type="button" class="btn btn-danger" id="btnCancelApp">取消申请</button>
        </div>
      `;
      container.appendChild(form);

      // 渲染当前截图（可点击放大）
      const currentBox = document.getElementById('editCurrentScreenshots');
      if (app.screenshots && app.screenshots.length > 0) {
        app.screenshots.forEach(f => {
          const wrapper = document.createElement('div');
          wrapper.className = 'img-wrapper';
          const img = document.createElement('img');
          const src = `/api/screenshots/${encodeURIComponent(app.id)}/${f}`;
          img.onclick = (e) => { e.stopPropagation(); showImageModal(img.src); };
          wrapper.appendChild(img);
          currentBox.appendChild(wrapper);
          loadImageWithRetry(img, src, 2);
        });
      } else {
        currentBox.innerHTML = '<span style="color:#94a3b8;font-size:14px;">无</span>';
      }

      // 选择新截图
      document.getElementById('editScreenshots').addEventListener('change', function () {
        const files = Array.from(this.files || []).filter(f => f.type.startsWith('image/'));
        if (files.length === 0) return;
        if (newScreenshots.length + files.length > 2) {
          flashError('最多上传 2 张证明图片');
          this.value = '';
          return;
        }
        Promise.all(files.map(f => compressImage(f))).then(arr => {
          newScreenshots = newScreenshots.concat(arr);
          this.value = '';
          renderEditPreview();
        }).catch(() => flashError('图片处理失败'));
      });

      // 提交修改
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        await submitEdit();
      });

      // 取消申请
      document.getElementById('btnCancelApp').addEventListener('click', function () {
        cancelApplication(this);
      });
    }

    function renderEditPreview() {
      const box = document.getElementById('editPreview');
      box.innerHTML = '';
      newScreenshots.forEach((file, idx) => {
        const reader = new FileReader();
        reader.onload = e => {
          const div = document.createElement('div');
          div.className = 'preview-item';
          div.innerHTML = `<img src="${e.target.result}" /><button type="button" class="remove-btn" data-idx="${idx}">×</button>`;
          box.appendChild(div);
          div.querySelector('img').onclick = (ev) => { ev.stopPropagation(); showImageModal(e.target.result); };
          div.querySelector('.remove-btn').addEventListener('click', () => {
            newScreenshots.splice(idx, 1);
            renderEditPreview();
          });
        };
        reader.readAsDataURL(file);
      });
    }

    /* ============================================
       分发渲染：可编辑 or 只读
       ============================================ */
    function renderDetail(app) {
      const editable = app.status === 'needs_fix' && isOwner;
      if (editable) renderEditableDetail(app);
      else renderReadonlyDetail(app);
    }

    /* ============================================
       提交修改（PUT /api/apps）
       ============================================ */
    async function submitEdit() {
      if (!currentApp || editPending || cancelPending) return;
      const btn = document.getElementById('btnSubmitEdit');
      const versionName = document.getElementById('editVersionName').value.trim();
      const publisher = fromDatetimeLocal(document.getElementById('editPublisher').value);
      const participants = document.getElementById('editParticipants').value.trim();

      if (!versionName) { flashError('请填写活动名称'); return; }
      if (!publisher) { flashError('请填写活动时间'); return; }

      const formData = new FormData();
      formData.append('id', currentApp.id);
      formData.append('studentId', user.studentId);
      formData.append('versionName', versionName);
      formData.append('publisher', publisher);
      formData.append('participants', participants);
      newScreenshots.forEach(f => formData.append('screenshots', f));

      editPending = true;
      setEditActionsDisabled(true);
      let succeeded = false;
      try {
        const res = await fetch('/api/apps', { method: 'PUT', body: formData });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '提交失败');
        succeeded = true;
        flashSuccess('修改已提交，等待重新审核');
        window.apiCache?.invalidatePrefix('/api/apps');
        window.syncBus?.emit('apps', { action: 'update', id: currentApp.id });
        setTimeout(() => window.location.reload(), 800);
      } catch (e) {
        flashError(e.message || '网络错误，请重试');
      } finally {
        editPending = false;
        if (!succeeded) setEditActionsDisabled(false);
      }
    }

    /* ============================================
       取消申请（DELETE /api/apps）：双按钮锁定 + 不可关闭的阻断窗口
       ============================================ */
    function cancelApplication() {
      if (!currentApp || !isOwner || cancelPending || editPending) return;
      showConfirm(
        '确认取消',
        '确定要取消这条申请吗？此操作不可恢复。',
        '确定取消', '再想想',
        async function (confirmed) {
          if (!confirmed || cancelPending || editPending || !currentApp) return;
          cancelPending = true;
          setEditActionsDisabled(true);
          showCancelProgress();
          window.addEventListener('beforeunload', preventLeaveWhileCancelling);
          let succeeded = false;
          try {
            const res = await fetch('/api/apps', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: currentApp.id, studentId: String(user.studentId) })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || '取消失败，请稍后重试');
            succeeded = true;
            window.apiCache?.invalidatePrefix('/api/apps');
            window.syncBus?.emit('apps', { action: 'delete', id: currentApp.id });
            // 服务器确认成功才释放阻断状态，随后直接返回列表。
            endCancelProgress();
            flashSuccess('申请已取消');
            window.location.replace('/index.html');
          } catch (e) {
            flashError(e.message || '网络错误，请重试');
          } finally {
            if (!succeeded) endCancelProgress();
          }
        }
      );
    }

    /* ============================================
       加载详情
       ============================================ */
    async function loadDetail() {
      const params = new URLSearchParams(window.location.search);
      const id = params.get('id');
      if (!id) { window.location.href = '/'; return; }

      const el = document.getElementById('detailContent');
      el.innerHTML = '加载中...';

      try {
        let app = null;
        const allApps = await apiCache.get('/api/apps', { ttl: 5000 });
        app = allApps.find(a => a.id === id);

        if (!app) {
          const res = await fetch(`/api/apps/${encodeURIComponent(id)}`);
          if (!res.ok) {
            if (res.status === 404) throw new Error('申请不存在');
            throw new Error('加载失败');
          }
          app = await res.json();
        }

        currentApp = app;
        isOwner = !!(token && user && user.studentId != null && String(user.studentId) === String(app.packageName));
        newScreenshots = [];
        document.title = (app.versionName || '申请') + ' - 学分申请系统';
        renderDetail(app);
      } catch (e) {
        el.innerHTML = `
          <div class="error-container">
            <div class="icon">
              <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>
            <h2>加载失败</h2>
            <p>${e.message || '未知错误'}</p>
            <a href="/" class="btn btn-primary">返回首页</a>
          </div>
        `;
      }
    }
    loadDetail();

    /* ============================================
       跨标签页同步
       ============================================ */
    if (window.syncBus) {
      syncBus.on('apps', function () {
        if (window.apiCache) apiCache.invalidatePrefix('/api/apps');
      });
    }
  
    window.escapeHtml = escapeHtml;
    window.showImageModal = showImageModal;
    window.loadImageWithRetry = loadImageWithRetry;
    window.compressImage = compressImage;
    window.toDatetimeLocal = toDatetimeLocal;
    window.fromDatetimeLocal = fromDatetimeLocal;
    window.getStatusTag = getStatusTag;
    window.renderReadonlyDetail = renderReadonlyDetail;
    window.renderEditableDetail = renderEditableDetail;
    window.renderEditPreview = renderEditPreview;
    window.renderDetail = renderDetail;
    window.submitEdit = submitEdit;
    window.cancelApplication = cancelApplication;
    window.loadDetail = loadDetail;

}
