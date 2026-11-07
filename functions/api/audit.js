import { getFileFromGitee, writeJsonToGitee } from '../utils/gitee';

// 独立的消息发送任务（在响应返回后异步执行）
function createMessageTask(env, studentId, title, content, type, appId) {
  return (async () => {
    try {
      let messages = [];
      let sha = null;
      try {
        const result = await getFileFromGitee(env, 'data/messages.json');
        messages = result.content || [];
        sha = result.sha;
      } catch (e) {
        if (!e.message.includes('404')) throw e;
      }
      const newMsg = {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        studentId,
        title,
        content,
        type,
        appId: appId || null,
        read: false,
        createdAt: Date.now(),
      };
      messages.push(newMsg);
      await writeJsonToGitee(env, 'data/messages.json', messages, sha, 'add message');
    } catch (e) {
      console.error('消息发送失败:', e);
    }
  })();
}

export async function onRequest(context) {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token) {
    return new Response(JSON.stringify({ error: '未授权' }), { status: 401, headers });
  }

  // GET 获取待审核列表
  if (request.method === 'GET') {
    try {
      const result = await getFileFromGitee(env, 'data/app.json');
      const apps = result.content || [];
      const pending = apps.filter(a => a.status === 'pending');
      return new Response(JSON.stringify(pending), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // PUT 审核操作
  if (request.method === 'PUT') {
    try {
      const body = await request.json();
      const { id, action, rejectReason } = body;
      if (!id || !action) {
        return new Response(JSON.stringify({ error: '参数缺失' }), { status: 400, headers });
      }

      // 1. 读取当前数据
      const result = await getFileFromGitee(env, 'data/app.json');
      const apps = result.content || [];
      const sha = result.sha;
      const index = apps.findIndex(a => a.id === id);
      if (index === -1) {
        return new Response(JSON.stringify({ error: '申请不存在' }), { status: 404, headers });
      }

      const app = apps[index];
      let messageTask = null;
      let responseBody = { message: '操作成功' };

      // 2. 根据操作处理数据
      if (action === 'approve') {
        app.status = 'approved';
        app.reviewedAt = Date.now();

        // 先写 app.json（关键数据）
        await writeJsonToGitee(env, 'data/app.json', apps, sha, `approve ${id}`);

        // 创建异步消息任务
        messageTask = createMessageTask(
          env,
          app.packageName,
          '学分申请已通过',
          `您的活动「${app.versionName}」学分申请已通过审核。`,
          'approved',
          app.id
        );
        responseBody = { message: '操作成功' };
      }
      else if (action === 'needs_fix') {
        app.status = 'needs_fix';
        app.reviewedAt = Date.now();
        app.rejectReason = rejectReason || '未填写原因';

        await writeJsonToGitee(env, 'data/app.json', apps, sha, `needs_fix ${id}`);

        messageTask = createMessageTask(
          env,
          app.packageName,
          '学分申请需要修改',
          `您的活动「${app.versionName}」学分申请需要修改。\n原因：${rejectReason || '未填写原因'}`,
          'needs_fix',
          app.id
        );
        responseBody = { message: '已通知申请人，申请保留' };
      }
      else if (action === 'reject') {
        const filtered = apps.filter(a => a.id !== id);
        await writeJsonToGitee(env, 'data/app.json', filtered, sha, `reject & delete ${id}`);

        messageTask = createMessageTask(
          env,
          app.packageName,
          '学分申请未通过',
          `您的活动「${app.versionName}」学分申请未通过审核。\n原因：${rejectReason || '未填写原因'}`,
          'rejected',
          app.id
        );
        responseBody = { message: '已通知申请人并删除申请' };
      }
      else {
        return new Response(JSON.stringify({ error: '无效操作' }), { status: 400, headers });
      }

      // 3. 先创建响应对象
      const response = new Response(JSON.stringify(responseBody), { status: 200, headers });

      // 4. 用 context.waitUntil 让消息任务在响应返回后继续执行
      if (messageTask) {
        try {
          if (context.waitUntil && typeof context.waitUntil === 'function') {
            context.waitUntil(messageTask);
          } else {
            messageTask.catch(e => console.error('message task error:', e));
          }
        } catch (e) {
          console.error('waitUntil error:', e);
          messageTask.catch(e => console.error('message task error:', e));
        }
      }

      // 5. 立即返回响应
      return response;
    } catch (e) {
      console.error('audit error:', e);
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  return new Response('Method not allowed', { status: 405 });
}