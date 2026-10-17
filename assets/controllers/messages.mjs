/** Vue 3 page controller — messages.
 * Mounted by the Vue PageContent component; API operations remain unchanged.
 * Business DOM fragments from the pre-Vue project are preserved for compatibility.
 */
export function mount() {

    const token = localStorage.getItem('studentToken');
    const userStr = localStorage.getItem('studentUser');
    let user = null;
    try { user = userStr ? JSON.parse(userStr) : null; } catch(e) {}

    const ARROW_SVG = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`;

    function escapeHtml(str) { const d=document.createElement('div'); d.textContent=str; return d.innerHTML; }

    function formatTime(ts) {
      const d = new Date(ts);
      const now = new Date();
      const diff = now - d;
      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
      if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
      if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + '天前';
      return d.toLocaleString('zh-CN');
    }

    function formatFullTime(ts) {
      return new Date(ts).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }

    function getTypeLabel(type) {
      if (type === 'approved') return '通过';
      if (type === 'needs_fix') return '驳回修改';
      if (type === 'rejected') return '未通过';
      return '系统';
    }

    let messagesCache = [];
    const MESSAGES_TTL = 0;

    function messagesUrl() {
      return '/api/messages?studentId=' + encodeURIComponent(user.studentId);
    }

    async function loadMessages(force = true) {
      const list = document.getElementById('msgList');
      const empty = document.getElementById('msgEmpty');
      try {
        messagesCache = await apiCache.get(messagesUrl(), { ttl: MESSAGES_TTL, force });
        if (messagesCache.length === 0) {
          list.innerHTML = '';
          empty.style.display = 'block';
          return;
        }
        empty.style.display = 'none';
        list.innerHTML = messagesCache.map(m => {
          const typeClass = m.type || 'system';
          const typeLabel = getTypeLabel(typeClass);
          const preview = (m.content || '').replace(/\n/g, ' ').substring(0, 60);
          return `
            <div class="msg-item ${m.read ? 'read' : ''}" data-message-id="${m.id}">
              <div class="msg-main">
                <div class="msg-title">
                  ${!m.read ? '<span class="unread-dot"></span>' : ''}
                  <span class="msg-type-tag ${typeClass}">${typeLabel}</span>
                  ${escapeHtml(m.title)}
                </div>
                <div class="msg-preview">${escapeHtml(preview)}${preview.length >= 60 ? '...' : ''}</div>
              </div>
              <div class="msg-meta">
                <div class="msg-time">${formatTime(m.createdAt)}</div>
                <div class="msg-arrow">${ARROW_SVG}</div>
              </div>
            </div>
          `;
        }).join('');

        list.querySelectorAll('.msg-item').forEach(item => {
          item.addEventListener('click', () => {
            const id = item.dataset.messageId;
            openMessageDetail(id);
          });
        });
      } catch (e) {
        list.innerHTML = `<div class="empty-state" style="color:red">加载失败：${escapeHtml(e.message)}</div>`;
      }
    }

    function openMessageDetail(messageId) {
      const msg = messagesCache.find(m => m.id === messageId);
      if (!msg) return;

      const card = document.getElementById('msgDetailCard');
      const typeClass = msg.type || 'system';
      const typeLabel = getTypeLabel(typeClass);

      card.innerHTML = `
        <div class="msg-detail-header">
          <h2>${escapeHtml(msg.title)}</h2>
          <button class="msg-detail-close" onclick="closeMessageDetail()">×</button>
        </div>
        <div class="msg-detail-meta">
          <span class="msg-type-tag ${typeClass}">${typeLabel}</span>
          <span class="msg-detail-time">${formatFullTime(msg.createdAt)}</span>
        </div>
        <div class="msg-detail-content">${escapeHtml(msg.content)}</div>
      `;

      document.getElementById('msgDetailOverlay').classList.add('show');

      if (!msg.read) {
        msg.read = true;
        const cardEl = document.querySelector(`.msg-item[data-message-id="${messageId}"]`);
        if (cardEl) {
          cardEl.classList.add('read');
          const dot = cardEl.querySelector('.unread-dot');
          if (dot) dot.remove();
        }
        fetch('/api/messages?action=mark-read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId })
        }).then(() => {
          apiCache.invalidatePrefix('/api/messages');
        }).catch(() => {});
      }
    }

    function closeMessageDetail() {
      document.getElementById('msgDetailOverlay').classList.remove('show');
    }

    document.getElementById('msgDetailOverlay').addEventListener('click', function(e) {
      if (e.target === this) closeMessageDetail();
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeMessageDetail();
    });

    async function markAllRead(btn) {
      showConfirm('确认操作', '确定要将所有消息标记为已读吗？', '确定', '取消', async function(confirmed) {
        if (!confirmed) return;
        await withLoading(btn, async () => {
          try {
            await fetch('/api/messages?action=mark-all-read', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ studentId: user.studentId })
            });
            apiCache.invalidatePrefix('/api/messages');
            flashSuccess('全部已标记为已读');
            loadMessages(true);
          } catch (e) {
            flashError('网络错误，请重试');
          }
        });
      });
    }

    loadMessages(true);
  
    window.escapeHtml = escapeHtml;
    window.formatTime = formatTime;
    window.formatFullTime = formatFullTime;
    window.getTypeLabel = getTypeLabel;
    window.messagesUrl = messagesUrl;
    window.loadMessages = loadMessages;
    window.openMessageDetail = openMessageDetail;
    window.closeMessageDetail = closeMessageDetail;
    window.markAllRead = markAllRead;

}
