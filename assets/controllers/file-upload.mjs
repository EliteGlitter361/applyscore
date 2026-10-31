/** Vue 3 page controller — file-upload.
 * Mounted by the Vue PageContent component; API operations remain unchanged.
 * Business DOM fragments from the pre-Vue project are preserved for compatibility.
 */
export function mount(vm) {

    // Vue frame stays visible while settings are requested (no blank flash).
  

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

    let countdownTimer = null;
    let allowMultiple = true;
    let maxFileSizeMB = 20;
    let currentXhr = null;
    let isUploading = false;

    const SETTINGS_TTL = 60000;

    function compressImage(file) {
      return new Promise((resolve) => {
        if (!file.type.startsWith('image/')) { resolve(file); return; }
        if (file.size < 500 * 1024) { resolve(file); return; }
        const reader = new FileReader();
        reader.onload = e => {
          const img = new Image();
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              let width = img.width;
              let height = img.height;
              const MAX = 1600;
              if (width > height) {
                if (width > MAX) { height *= MAX / width; width = MAX; }
              } else {
                if (height > MAX) { width *= MAX / height; height = MAX; }
              }
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, width, height);
              canvas.toBlob(blob => {
                if (!blob) { resolve(file); return; }
                const compressed = new File([blob], file.name, { type: 'image/jpeg' });
                resolve(compressed);
              }, 'image/jpeg', 0.8);
            } catch (err) { resolve(file); }
          };
          img.onerror = () => resolve(file);
          img.src = e.target.result;
        };
        reader.onerror = () => resolve(file);
        reader.readAsDataURL(file);
      });
    }

    async function init() {
      let settings = {};
      try {
        settings = window.__fileUploadSettings || await apiCache.get('/api/settings', { ttl: SETTINGS_TTL });
      } catch (e) {
        console.warn('获取设置失败', e);
      }
      window.__settings = settings;

      if (settings.fileUploadEnabled === false) {
        window.location.replace('/close.html?msg=' + encodeURIComponent('文件上传功能已关闭'));
        return;
      }
      if (settings.fileUploadDeadlineEnabled && settings.fileUploadDeadline) {
        if (Date.now() > settings.fileUploadDeadline) {
          window.location.replace('/close.html?msg=' + encodeURIComponent('文件上传已截止'));
          return;
        }
      }

      allowMultiple = settings.allowMultipleFiles !== false;
      maxFileSizeMB = typeof settings.maxFileSizeMB === 'number' && settings.maxFileSizeMB > 0
        ? settings.maxFileSizeMB : 20;

      const fileInput = document.getElementById('fileInput');
      vm.fileUploadAllowedMultiple=allowMultiple;vm.fileUploadMaxMB=maxFileSizeMB;
      if (!allowMultiple) {
        fileInput.removeAttribute('multiple');
        fileInput.multiple = false;
        vm.fileUploadHint = `当前只允许上传一个文件，单个文件不超过 ${maxFileSizeMB}MB`;
      } else {
        fileInput.multiple = true;
        vm.fileUploadHint = `支持任意格式，单个文件不超过 ${maxFileSizeMB}MB，可上传多个文件`;
      }

      document.documentElement.style.display = '';

      startCountdown(settings);

      if (settings.uploadRequirementEnabled && settings.uploadRequirementMessage) {
        setTimeout(() => {
          if (typeof showAlert === 'function') {
            showAlert('文件上传要求', settings.uploadRequirementMessage, '我知道了', null, { textAlign: 'left' });
          } else {
            alert(settings.uploadRequirementMessage);
          }
        }, 200);
      }
    }

    function startCountdown(settings) {
      if (!settings.fileUploadDeadlineEnabled || !settings.fileUploadDeadline) {
        vm.fileUploadCountdown='';vm.fileUploadExpired=false;return;
      }
      const deadline=Number(settings.fileUploadDeadline);
      function update(){
        const diff=deadline-Date.now();
        if(diff<=0){vm.fileUploadCountdown='已截止';vm.fileUploadCountdownUrgent=true;vm.fileUploadExpired=true;
          if(countdownTimer){clearInterval(countdownTimer);countdownTimer=null;}return;}
        const total=Math.floor(diff/1000),days=Math.floor(total/86400),h=Math.floor(total%86400/3600),m=Math.floor(total%3600/60),sec=total%60;
        vm.fileUploadCountdown=(days?days+'天 ':'')+[h,m,sec].map(n=>String(n).padStart(2,'0')).join(':');
        vm.fileUploadCountdownUrgent=diff<300000;vm.fileUploadExpired=false;
      }
      update();countdownTimer=setInterval(update,1000);
    }

    const fileInput = document.getElementById('fileInput');
    let selectedFiles = [];
    function updateFileList() {
      vm.fileUploadSelections = selectedFiles.map((file, idx) => ({
        key: idx + ':' + file.name + ':' + file.size,
        name: file.name,
        sizeKB: (file.size / 1024).toFixed(1)
      }));
    }
    function removeSelectedFile(idx) {
      if (isUploading || idx < 0 || idx >= selectedFiles.length) return;
      selectedFiles.splice(idx, 1);
      updateFileList();
    }

    fileInput.addEventListener('change', async function () {
      const rawFiles = Array.from(this.files);
      this.value = '';
      if (rawFiles.length === 0) return;

      const maxBytes = maxFileSizeMB * 1024 * 1024;
      showToast('正在处理文件...', 'info', 1500);

      const files = [];
      for (const f of rawFiles) {
        const compressed = await compressImage(f);
        files.push(compressed);
      }

      for (const f of files) {
        if (f.size > maxBytes) {
          if (typeof showAlert === 'function') {
            showAlert('提示', `文件 "${f.name}" 超过 ${maxFileSizeMB}MB 限制，请重新选择`, '我知道了');
          } else {
            showToast(`文件 ${f.name} 超过 ${maxFileSizeMB}MB`, 'error');
          }
          return;
        }
      }

      if (!allowMultiple) {
        if (files.length > 1) {
          if (typeof showAlert === 'function') {
            showAlert('提示', '当前只允许上传一个文件，请只选择一个文件', '我知道了');
          } else showToast('当前只允许上传一个文件', 'error');
          return;
        }
        if (selectedFiles.length >= 1) {
          if (typeof showAlert === 'function') {
            showAlert('提示', '当前只允许上传一个文件，请先点击文件右侧的 × 删除已有文件后再选择新文件', '我知道了');
          } else showToast('当前只允许上传一个文件，请先删除已有文件', 'error');
          return;
        }
        selectedFiles = [files[0]];
        updateFileList();
        return;
      }

      for (const f of files) {
        if (selectedFiles.length >= 5) {
          showToast('最多上传5个文件', 'error');
          break;
        }
        selectedFiles.push(f);
      }
      updateFileList();
    });

    function cancelUpload() {
      if (currentXhr && isUploading) {
        currentXhr.abort();
      }
    }

    document.getElementById('uploadForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (isUploading) return;

      const name = vm.fileUploadPersonName.trim();
      const studentId = vm.fileUploadPersonId.trim();
      if (!name || !studentId) { showToast('请填写姓名和学号', 'error'); return; }
      if (selectedFiles.length === 0) { showToast('请至少选择一个文件', 'error'); return; }
      if (!allowMultiple && selectedFiles.length > 1) {
        if (typeof showAlert === 'function') showAlert('提示', '当前只允许上传一个文件', '我知道了');
        else showToast('当前只允许上传一个文件', 'error');
        return;
      }

      const formData = new FormData();
      formData.append('name', name);
      formData.append('studentId', studentId);
      for (const file of selectedFiles) formData.append('files', file);

      vm.fileUploadModalFiles=selectedFiles.map(f=>({name:f.name,sizeKB:(f.size/1024).toFixed(1)}));
      vm.fileUploadModalProgress=0;vm.fileUploadModalWaiting=false;
      vm.fileUploadModalOpen=true;vm.fileUploadBusy=true;isUploading=true;

      const xhr = new XMLHttpRequest();
      currentXhr = xhr;
      xhr.open('POST', '/api/files', true);
      xhr.timeout = 5 * 60 * 1000;

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          vm.fileUploadModalProgress=percent;
          if (percent >= 100) {
            vm.fileUploadModalWaiting=true;
          }
        }
      });

      xhr.onload = function () {
        isUploading = false;
        currentXhr = null;
        vm.fileUploadModalOpen=false;vm.fileUploadBusy=false;vm.fileUploadModalWaiting=false;

        if (xhr.status >= 200 && xhr.status < 300) {
          apiCache.invalidate('/api/files');
          apiCache.invalidate('/api/uploads');
          if (window.syncBus) syncBus.emit('files', { action: 'upload' });

          let data = {};
          try { data = JSON.parse(xhr.responseText); } catch (e) {}

          if (data.failedFiles && data.failedFiles.length > 0) {
            const failList = data.failedFiles.map(f => `${f.name}（${f.error}）`).join('\n');
            if (typeof showAlert === 'function') {
              showAlert('部分上传成功',
                `成功 ${data.upload?.files?.length || 0} 个\n失败 ${data.failedFiles.length} 个：\n${failList}`,
                '我知道了');
            } else alert('部分上传成功，部分失败：\n' + failList);
            selectedFiles = [];
            updateFileList();
            vm.fileUploadPersonName='';vm.fileUploadPersonId='';
          } else {
            if (window.flashSuccess) flashSuccess('文件上传成功');
            if (typeof showAlert === 'function') {
              showAlert('上传成功', '您的文件已成功上传！', '确定', function () {
                selectedFiles = [];
                updateFileList();
                vm.fileUploadPersonName='';vm.fileUploadPersonId='';
              });
            } else {
              alert('上传成功！');
              selectedFiles = [];
              updateFileList();
              document.getElementById('name').value = '';
              document.getElementById('studentId').value = '';
            }
          }
        } else {
          let errMsg = '上传失败，请重试';
          try { errMsg = JSON.parse(xhr.responseText).error || errMsg; } catch (e) {}
          if (window.flashError) flashError(errMsg);
          if (typeof showAlert === 'function') showAlert('上传失败', errMsg, '我知道了');
          else showToast(errMsg, 'error', 4000);
        }
      };

      xhr.onerror = function () {
        isUploading = false;
        currentXhr = null;
        vm.fileUploadModalOpen=false;vm.fileUploadBusy=false;vm.fileUploadModalWaiting=false;
        if (window.flashError) flashError('网络错误，无法连接到服务器');
        if (typeof showAlert === 'function') showAlert('网络错误', '无法连接到服务器，请检查网络后重试', '我知道了');
        else showToast('网络错误，请检查连接', 'error', 4000);
      };

      xhr.ontimeout = function () {
        isUploading = false;
        currentXhr = null;
        vm.fileUploadModalOpen=false;vm.fileUploadBusy=false;vm.fileUploadModalWaiting=false;
        if (window.flashError) flashError('上传超时');
        if (typeof showAlert === 'function') showAlert('上传超时', '文件较大或网络较慢，请稍后重试或减少文件数量', '我知道了');
        else showToast('上传超时，请重试', 'error', 4000);
      };

      xhr.onabort = function () {
        isUploading = false;
        currentXhr = null;
        vm.fileUploadModalOpen=false;vm.fileUploadBusy=false;vm.fileUploadModalWaiting=false;
        showToast('已取消上传', 'warning', 2000);
      };

      xhr.send(formData);
    });

    init();
  
    vm.fileUploadPersonName=JSON.parse(localStorage.getItem('studentUser')||'{}').name||'';
    vm.fileUploadPersonId=JSON.parse(localStorage.getItem('studentUser')||'{}').studentId||'';
    window.showToast = showToast;
    window.compressImage = compressImage;
    window.init = init;
    window.startCountdown = startCountdown;
    window.updateFileList = updateFileList;
    window.removeSelectedFile = removeSelectedFile;
    window.cancelUpload = cancelUpload;

    return () => { if (countdownTimer) clearInterval(countdownTimer); if (toastTimer) clearTimeout(toastTimer); delete window.removeSelectedFile; };
}
