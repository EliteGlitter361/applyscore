/** Vue 3 page controller — upload.
 * Mounted by the Vue PageContent component; API operations remain unchanged.
 * Business DOM fragments from the pre-Vue project are preserved for compatibility.
 */
export function mount() {

  

    const studentUser = JSON.parse(localStorage.getItem('studentUser') || '{}');
    document.getElementById('name').value = studentUser.name || '';
    document.getElementById('studentId').value = studentUser.studentId || '';

    let toastTimer;
    function showToast(msg, type = 'info', dur = 2800) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.className = 'toast ' + type;
      void el.offsetWidth;
      el.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.remove('show'), dur);
    }

    let fp = null;

    function initFlatpickr() {
      if (typeof flatpickr === 'undefined') {
        // Lightweight native date/time control when optional calendar library is absent.
        const input = document.getElementById('time');
        input.readOnly = false; input.type = 'datetime-local';
        const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
        input.value = now.toISOString().slice(0, 16);
        return;
      }
      if (typeof flatpickr.l10ns !== 'undefined' && flatpickr.l10ns.zh) {
        flatpickr.localize(flatpickr.l10ns.zh);
      }
      const now = new Date();
      const y = now.getFullYear(),
            m = String(now.getMonth() + 1).padStart(2, '0'),
            d = String(now.getDate()).padStart(2, '0'),
            h = String(now.getHours()).padStart(2, '0'),
            min = String(now.getMinutes()).padStart(2, '0');
      const def = `${y}-${m}-${d} ${h}:${min}`;
      fp = flatpickr('#time', {
        enableTime: true,
        dateFormat: "Y-m-d H:i",
        time_24hr: true,
        defaultDate: def,
        allowInput: false
      });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initFlatpickr);
    } else {
      initFlatpickr();
    }

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

    const fileInput = document.getElementById('imageUpload');
    const fileCount = document.getElementById('fileCount');
    const preview = document.getElementById('preview');
    let selectedFiles = [];

    function showImageModal(src) {
      const modal = document.createElement('div');
      modal.className = 'image-modal';
      const img = document.createElement('img');
      img.src = src;
      modal.appendChild(img);
      modal.onclick = () => modal.remove();
      document.body.appendChild(modal);
    }

    function updatePreview() {
      preview.innerHTML = '';
      fileCount.textContent = selectedFiles.length + ' / 2';
      selectedFiles.forEach((file, idx) => {
        const reader = new FileReader();
        reader.onload = e => {
          const div = document.createElement('div');
          div.className = 'preview-item';
          div.innerHTML = `<img src="${e.target.result}" /><button type="button" class="remove-btn" data-idx="${idx}">×</button>`;
          preview.appendChild(div);
          div.querySelector('img').onclick = (ev) => { ev.stopPropagation(); showImageModal(e.target.result); };
          div.querySelector('.remove-btn').addEventListener('click', () => removeFile(idx));
        };
        reader.readAsDataURL(file);
      });
      fileInput.disabled = selectedFiles.length >= 2;
      fileInput.style.opacity = selectedFiles.length >= 2 ? '0.6' : '1';
    }

    function removeFile(idx) { selectedFiles.splice(idx, 1); fileInput.value = ''; updatePreview(); }

    fileInput.addEventListener('change', function () {
      const files = Array.from(this.files).filter(f => f.type.startsWith('image/'));
      if (files.length === 0) return showToast('请选择有效图片', 'error');
      if (selectedFiles.length + files.length > 2) {
        showToast(`最多上传2张，已选${selectedFiles.length}张`, 'error');
        this.value = ''; return;
      }
      Promise.all(files.map(file => compressImage(file))).then(compressedFiles => {
        selectedFiles = selectedFiles.concat(compressedFiles);
        this.value = ''; updatePreview();
      }).catch(() => showToast('图片压缩失败', 'error'));
    });
    updatePreview();

    document.getElementById('applyForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      const name = document.getElementById('name').value.trim();
      const studentId = document.getElementById('studentId').value.trim();
      const activity = document.getElementById('activity').value.trim();
      const location = document.getElementById('location').value.trim();
      const time = document.getElementById('time').value.replace('T', ' ');
      const participants = document.getElementById('participants').value.trim();

      if (!name || !studentId || !activity || !location || !time) {
        showToast('请完整填写所有必填项！', 'error'); return;
      }
      if (selectedFiles.length === 0) { showToast('请至少上传一张证明图片！', 'error'); return; }

      const formData = new FormData();
      formData.append('name', name);
      formData.append('packageName', studentId);
      formData.append('versionName', activity);
      formData.append('publisher', time);
      if (participants) formData.append('participants', participants);
      for (let file of selectedFiles) formData.append('screenshots', file);

      const submitBtn = this.querySelector('.btn-submit');
      if (submitBtn.disabled) return; // request already in progress
      let active = true;
      const showProgress = (stage, percent = 0, reason = '') => window.__setUploadProgress?.(stage, percent, reason);
      const preventLeaving = event => { if (!active) return; event.preventDefault(); event.returnValue = ''; };
      window.addEventListener('beforeunload', preventLeaving);
      const finish = () => {
        active = false;
        window.removeEventListener('beforeunload', preventLeaving);
        submitBtn.disabled = false;
        submitBtn.textContent = '提交申请';
      };
      submitBtn.disabled = true;
      submitBtn.textContent = '提交中…';
      showProgress('uploading', 0);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/apps', true);
      xhr.timeout = 90000;
      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable && active) {
          const pct = Math.min(100, Math.round(e.loaded / e.total * 100));
          showProgress(pct >= 100 ? 'saving' : 'uploading', pct);
        }
      });
      xhr.upload.addEventListener('load', () => { if (active) showProgress('saving', 100); });
      xhr.onload = () => {
        if (!active) return;
        finish();
        if (xhr.status >= 200 && xhr.status < 300) {
          showProgress('success', 100);
          window.apiCache?.invalidate('/api/apps');
          window.syncBus?.emit('apps', { action: 'create' });
          setTimeout(() => window.location.replace('/index.html'), 850);
        } else {
          let msg = '提交失败，请重试';
          try { msg = JSON.parse(xhr.responseText).error || msg; } catch (_) {}
          showProgress('error', 0, msg);
          window.flashError?.(msg);
        }
      };
      const failed = reason => {
        if (!active) return;
        finish();
        showProgress('error', 0, reason);
        window.flashError?.(reason);
      };
      xhr.onerror = () => failed('网络错误，请检查连接后重试');
      xhr.ontimeout = () => failed('提交超时，请检查网络和申请状态后重试');
      xhr.onabort = () => failed('提交已中断，请检查是否已保存');
      try { xhr.send(formData); } catch (error) { failed(error.message || '提交请求失败'); }
    });
  
    window.showToast = showToast;
    window.initFlatpickr = initFlatpickr;
    window.compressImage = compressImage;
    window.showImageModal = showImageModal;
    window.updatePreview = updatePreview;
    window.removeFile = removeFile;

}
