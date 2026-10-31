/** Application creation controller: Vue owns form fields, image previews, and events.
 * The existing /api/apps FormData contract and XHR progress states are unchanged.
 * Browser APIs are used only for image compression and network transport.
 */
export function mount(vm) {
  const user = (() => { try { return JSON.parse(localStorage.getItem('studentUser') || '{}'); } catch { return {}; } })();
  vm.applicationName = String(user.name || '');
  vm.applicationStudentId = String(user.studentId || '');
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  vm.applicationTime = local.toISOString().slice(0, 16);
  let disposed = false;
  let running = false;
  let activeXHR = null;
  let nextKey = 0;
  let redirectTimer = null;
  const uploadedItems = [];

  function notify(message) { window.flashError?.(message); }
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.onload = event => {
        const image = new Image();
        image.onerror = () => reject(new Error('图片格式无效'));
        image.onload = () => {
          const max = 700;
          const ratio = Math.min(1, max / Math.max(image.width, image.height));
          const width = Math.max(1, Math.round(image.width * ratio));
          const height = Math.max(1, Math.round(image.height * ratio));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d')?.drawImage(image, 0, 0, width, height);
          canvas.toBlob(blob => {
            if (!blob) { reject(new Error('图片压缩失败')); return; }
            resolve(new File([blob], file.name, { type: 'image/jpeg' }));
          }, 'image/jpeg', 0.5);
        };
        image.src = String(event.target.result || '');
      };
      reader.readAsDataURL(file);
    });
  }

  async function selectImages(event) {
    const input = event?.target;
    const files = Array.from(input?.files || []);
    if (input) input.value = '';
    if (!files.length || disposed || vm.applicationSubmitting || vm.applicationProcessingImages) return;
    if (vm.applicationImages.length + files.length > 2) {
      notify('最多上传2张证明图片'); return;
    }
    if (files.some(f => !f.type.startsWith('image/'))) {
      notify('请选择有效图片'); return;
    }
    vm.applicationProcessingImages = true;
    try {
      // Commit only when all images are valid, rather than leave half a selection.
      const compressed = await Promise.all(files.map(compressImage));
      if (disposed) return;
      for (const file of compressed) {
        const url = URL.createObjectURL(file);
        const entry = { key: ++nextKey, file, url };
        uploadedItems.push(entry);
      }
      vm.applicationImages = uploadedItems.map(({key, url}) => ({key, url}));
    } catch (error) {
      notify(error?.message || '图片处理失败');
    } finally { if (!disposed) vm.applicationProcessingImages = false; }
  }

  function removeImage(index) {
    if (disposed || vm.applicationSubmitting || vm.applicationProcessingImages) return;
    if (!Number.isInteger(index) || index < 0 || index >= uploadedItems.length) return;
    const [removed] = uploadedItems.splice(index, 1);
    URL.revokeObjectURL(removed.url);
    if (vm.applicationPreviewSrc === removed.url) vm.applicationPreviewSrc = '';
    vm.applicationImages = uploadedItems.map(({key, url}) => ({key, url}));
  }

  function submit() {
    if (disposed || running || vm.applicationProcessingImages) return;
    const name = vm.applicationName.trim();
    const studentId = vm.applicationStudentId.trim();
    const activity = vm.applicationActivity.trim();
    const location = vm.applicationLocation.trim();
    const time = vm.applicationTime.replace('T', ' ');
    const participants = vm.applicationParticipants.trim();
    if (!name || !studentId || !activity || !location || !time) {
      notify('请完整填写所有必填项！'); return;
    }
    if (!uploadedItems.length) { notify('请至少上传一张证明图片！'); return; }
    const formData = new FormData();
    formData.append('name', name);
    formData.append('packageName', studentId);
    formData.append('versionName', activity);
    formData.append('publisher', time);
    if (participants) formData.append('participants', participants);
    for (const item of uploadedItems) formData.append('screenshots', item.file);

    running = true;
    vm.applicationSubmitting = true;
    const progress = (stage, percent=0, reason='') => vm.updateUploadProgress(stage, percent, reason);
    const preventLeave = event => { if (!running) return; event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventLeave);
    function finish() {
      running = false;
      activeXHR = null;
      window.removeEventListener('beforeunload', preventLeave);
      if (!disposed) vm.applicationSubmitting = false;
    }
    progress('uploading', 0);
    const xhr = new XMLHttpRequest();
    activeXHR = xhr;
    xhr.open('POST', '/api/apps', true);
    xhr.timeout = 90000;
    xhr.upload.addEventListener('progress', event => {
      if (!running || disposed || !event.lengthComputable) return;
      const percent = Math.min(100, Math.round(100 * event.loaded / Math.max(1, event.total)));
      progress(percent >= 100 ? 'saving' : 'uploading', percent);
    });
    xhr.upload.addEventListener('load', () => { if (running && !disposed) progress('saving', 100); });
    xhr.onload = () => {
      if (!running) return;
      finish();
      if (disposed) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        progress('success', 100);
        window.apiCache?.invalidate('/api/apps');
        window.syncBus?.emit('apps', { action:'create' });
        redirectTimer = setTimeout(() => window.location.replace('/index.html'), 850);
      } else {
        let reason = '提交失败，请重试';
        try { reason = JSON.parse(xhr.responseText)?.error || reason; } catch {}
        progress('error', 0, reason);
        notify(reason);
      }
    };
    const fail = reason => {
      if (!running) return;
      finish();
      if (disposed) return;
      progress('error', 0, reason);
      notify(reason);
    };
    xhr.onerror = () => fail('网络错误，请检查连接后重试');
    xhr.ontimeout = () => fail('提交超时，请检查网络和申请状态后重试');
    xhr.onabort = () => fail('提交已中断，请检查是否已保存');
    try { xhr.send(formData); } catch (error) { fail(error?.message || '提交请求失败'); }
  }

  vm._applicationApi = { selectImages, removeImage, submit };
  return () => {
    disposed = true;
    if (redirectTimer) clearTimeout(redirectTimer);
    // Revoke preview URLs on unmount; the File objects have already been sent if applicable.
    for (const entry of uploadedItems) URL.revokeObjectURL(entry.url);
    if (activeXHR && running) activeXHR.abort();
    vm._applicationApi = null;
  };
}
