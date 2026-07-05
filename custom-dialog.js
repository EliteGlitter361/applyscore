// 自定义弹窗组件
// 用法：
//   showAlert('标题', '消息内容', '确认按钮文字', 回调)
//   showConfirm('标题', '消息内容', '确认按钮文字', '取消按钮文字', 回调(confirmed))
//   showPrompt('标题', '消息内容', '默认值', '占位符', '确认按钮', '取消按钮', 回调(value))

(function() {
  // 创建弹窗容器（只创建一次）
  let dialogContainer = null;

  function createDialogContainer() {
    if (dialogContainer) return dialogContainer;
    const div = document.createElement('div');
    div.id = 'custom-dialog-container';
    div.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 99999;
      padding: 20px;
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    `;
    document.body.appendChild(div);
    dialogContainer = div;
    return dialogContainer;
  }

  function buildDialog(options) {
    const {
      type, // 'alert', 'confirm', 'prompt'
      title,
      message,
      confirmText = '确定',
      cancelText = '取消',
      placeholder = '',
      defaultValue = '',
      onConfirm,
      onCancel,
    } = options;

    const container = createDialogContainer();
    container.innerHTML = '';

    // 弹窗卡片
    const card = document.createElement('div');
    card.style.cssText = `
      background: #fff;
      border-radius: 24px;
      max-width: 400px;
      width: 100%;
      padding: 28px 24px 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      animation: dialogFadeIn 0.25s ease;
      max-height: 90vh;
      overflow-y: auto;
    `;

    // 标题
    if (title) {
      const titleEl = document.createElement('h3');
      titleEl.style.cssText = `
        font-size: 20px;
        font-weight: 700;
        color: #0b1e3a;
        margin: 0 0 12px 0;
        text-align: center;
      `;
      titleEl.textContent = title;
      card.appendChild(titleEl);
    }

    // 消息
    const msgEl = document.createElement('p');
    msgEl.style.cssText = `
      font-size: 16px;
      color: #1a202c;
      margin: 0 0 20px 0;
      line-height: 1.6;
      text-align: center;
      white-space: pre-wrap;
      word-break: break-word;
    `;
    msgEl.textContent = message;
    card.appendChild(msgEl);

    // 如果是 prompt，添加输入框
    let inputEl = null;
    if (type === 'prompt') {
      inputEl = document.createElement('input');
      inputEl.type = 'text';
      inputEl.style.cssText = `
        width: 100%;
        padding: 12px 16px;
        border: 2px solid #e2e8f0;
        border-radius: 12px;
        font-size: 16px;
        margin-bottom: 20px;
        outline: none;
        transition: border-color 0.2s;
        box-sizing: border-box;
      `;
      inputEl.placeholder = placeholder || '请输入';
      inputEl.value = defaultValue || '';
      inputEl.addEventListener('focus', function() {
        this.style.borderColor = '#2a6df4';
      });
      inputEl.addEventListener('blur', function() {
        this.style.borderColor = '#e2e8f0';
      });
      card.appendChild(inputEl);
      setTimeout(() => inputEl.focus(), 100);
    }

    // 按钮容器
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = `
      display: flex;
      gap: 12px;
      justify-content: center;
      flex-wrap: wrap;
    `;

    // 取消按钮
    if (type === 'confirm' || type === 'prompt') {
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = cancelText;
      cancelBtn.style.cssText = `
        padding: 12px 24px;
        background: #edf2f7;
        color: #2d3748;
        border: none;
        border-radius: 40px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        flex: 1;
        min-width: 80px;
        transition: background 0.2s;
      `;
      cancelBtn.addEventListener('mouseenter', () => {
        cancelBtn.style.background = '#e2e8f0';
      });
      cancelBtn.addEventListener('mouseleave', () => {
        cancelBtn.style.background = '#edf2f7';
      });
      cancelBtn.addEventListener('click', function() {
        closeDialog();
        if (onCancel) onCancel();
      });
      btnContainer.appendChild(cancelBtn);
    }

    // 确认按钮
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = confirmText;
    confirmBtn.style.cssText = `
      padding: 12px 24px;
      background: #2a6df4;
      color: #fff;
      border: none;
      border-radius: 40px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      flex: 1;
      min-width: 80px;
      transition: background 0.2s;
    `;
    confirmBtn.addEventListener('mouseenter', () => {
      confirmBtn.style.background = '#1a4db5';
    });
    confirmBtn.addEventListener('mouseleave', () => {
      confirmBtn.style.background = '#2a6df4';
    });
    confirmBtn.addEventListener('click', function() {
      const value = type === 'prompt' ? inputEl.value : true;
      closeDialog();
      if (onConfirm) onConfirm(value);
    });
    btnContainer.appendChild(confirmBtn);

    card.appendChild(btnContainer);

    // 添加动画关键帧
    if (!document.getElementById('dialog-keyframes')) {
      const style = document.createElement('style');
      style.id = 'dialog-keyframes';
      style.textContent = `
        @keyframes dialogFadeIn {
          from { opacity: 0; transform: scale(0.95) translateY(20px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @media (max-width: 480px) {
          #custom-dialog-container {
            padding: 12px;
          }
          #custom-dialog-container .card {
            padding: 20px 16px;
          }
          #custom-dialog-container button {
            font-size: 15px;
            padding: 12px 16px;
            flex: 1 1 100%;
          }
        }
      `;
      document.head.appendChild(style);
    }

    // 点击遮罩关闭（仅 alert）
    if (type === 'alert') {
      container.addEventListener('click', function(e) {
        if (e.target === container) {
          closeDialog();
          if (onConfirm) onConfirm();
        }
      });
    } else {
      container.onclick = null;
    }

    container.appendChild(card);
    container.style.display = 'flex';

    function closeDialog() {
      container.style.display = 'none';
      container.onclick = null;
    }

    return closeDialog;
  }

  window.showAlert = function(title, message, confirmText = '确定', callback = null) {
    return buildDialog({
      type: 'alert',
      title,
      message,
      confirmText,
      onConfirm: callback || (() => {}),
    });
  };

  window.showConfirm = function(title, message, confirmText = '确定', cancelText = '取消', callback = null) {
    return buildDialog({
      type: 'confirm',
      title,
      message,
      confirmText,
      cancelText,
      onConfirm: (value) => {
        if (callback) callback(true);
      },
      onCancel: () => {
        if (callback) callback(false);
      },
    });
  };

  window.showPrompt = function(title, message, defaultValue = '', placeholder = '', confirmText = '确定', cancelText = '取消', callback = null) {
    return buildDialog({
      type: 'prompt',
      title,
      message,
      defaultValue,
      placeholder,
      confirmText,
      cancelText,
      onConfirm: (value) => {
        if (callback) callback(value);
      },
      onCancel: () => {
        if (callback) callback(null);
      },
    });
  };
})();