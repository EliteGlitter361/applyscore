import { getFileFromGitee, writeJsonToGitee } from '../utils/gitee';

export async function onRequest(context) {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  // GET: 获取某学生的消息
  if (request.method === 'GET') {
    try {
      const studentId = url.searchParams.get('studentId');
      const result = await getFileFromGitee(env, 'data/messages.json');
      let messages = result.content || [];
      if (studentId) {
        messages = messages.filter(m => m.studentId === studentId);
      }
      messages.sort((a, b) => b.createdAt - a.createdAt);
      return new Response(JSON.stringify(messages), { headers });
    } catch (e) {
      if (e.message.includes('404')) return new Response(JSON.stringify([]), { headers });
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // POST: 发送消息 或 标记已读
  if (request.method === 'POST') {
    try {
      const body = await request.json();

      // 标记单条已读
      if (action === 'mark-read') {
        const { messageId } = body;
        if (!messageId) return new Response(JSON.stringify({ error: '缺少messageId' }), { status: 400, headers });
        const result = await getFileFromGitee(env, 'data/messages.json');
        let messages = result.content || [];
        const sha = result.sha;
        const msg = messages.find(m => m.id === messageId);
        if (msg) {
          msg.read = true;
          await writeJsonToGitee(env, 'data/messages.json', messages, sha, 'mark read');
        }
        return new Response(JSON.stringify({ message: 'ok' }), { headers });
      }

      // 标记全部已读
      if (action === 'mark-all-read') {
        const { studentId } = body;
        if (!studentId) return new Response(JSON.stringify({ error: '缺少studentId' }), { status: 400, headers });
        const result = await getFileFromGitee(env, 'data/messages.json');
        let messages = result.content || [];
        const sha = result.sha;
        let changed = false;
        messages.forEach(m => {
          if (m.studentId === studentId && !m.read) {
            m.read = true;
            changed = true;
          }
        });
        if (changed) {
          await writeJsonToGitee(env, 'data/messages.json', messages, sha, 'mark all read');
        }
        return new Response(JSON.stringify({ message: 'ok' }), { headers });
      }

      // 发送消息（供其他接口内部调用，或管理员手动发送）
      const { studentId, title, content, type, appId } = body;
      if (!studentId || !title) {
        return new Response(JSON.stringify({ error: '缺少参数' }), { status: 400, headers });
      }
      const result = await getFileFromGitee(env, 'data/messages.json');
      let messages = result.content || [];
      const sha = result.sha;
      const newMsg = {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        studentId,
        title,
        content: content || '',
        type: type || 'system',
        appId: appId || null,
        read: false,
        createdAt: Date.now(),
      };
      messages.push(newMsg);
      await writeJsonToGitee(env, 'data/messages.json', messages, sha, 'add message');
      return new Response(JSON.stringify({ message: '发送成功', msg: newMsg }), { status: 201, headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  return new Response('Method not allowed', { status: 405 });
}