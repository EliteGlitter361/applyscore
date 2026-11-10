import {effectiveAdminPermissions} from '../utils/accounts.js';
import {syncFileTaskNotifications} from '../utils/file-task-notifications.js';
import {syncRequestNotifications} from '../utils/request-notifications.js';
import { getFileFromGitee, writeJsonToGitee } from '../utils/gitee';

export async function onRequest(context) {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const session = context.data?.accountSession;
  const studentIdFromSession = session?.state==='online' && session.row.kind==='student' ? session.row.id : null;

  if(request.method==='DELETE'){
    try{const sid=studentIdFromSession;if(!sid)return Response.json({error:'请先登录学生账号'},{status:401});const b=await request.json();if(b.all!==true&&(!Array.isArray(b.ids)||!b.ids.length))return Response.json({error:'请选择要删除的消息'},{status:400});let stored;try{stored=await getFileFromGitee(env,'data/messages.json')}catch(e){if(!String(e.message).includes('404'))throw e;stored={content:[],sha:null}}const ids=new Set((b.ids||[]).map(String));let count=0;for(const m of stored.content||[]){if(String(m.studentId)===sid&&!m.deleted&&(b.all===true||ids.has(String(m.id)))){m.readBeforeDelete=m.read===true;m.deleted=true;m.read=true;count++;}}if(count)await writeJsonToGitee(env,'data/messages.json',stored.content,stored.sha,'student delete messages');return Response.json({message:b.all===true?'消息已清空':'消息已删除',count});}catch(e){return Response.json({error:e.message},{status:500})}
  }

  if (request.method === 'GET' && url.searchParams.get('scope') === 'admin-history') {
    const historyHeaders = { 'Cache-Control': 'no-store' };
    const user = session?.state === 'online' && session.row.kind === 'admin' ? session.account : null;
    if (!user || !effectiveAdminPermissions(user, session.accounts).messagePermission) {
      return Response.json({error:'无权查看消息历史'}, {status:403, headers:historyHeaders});
    }

    try {
      const {content: messages} = await getFileFromGitee(env, 'data/messages.json', {fresh:true});
      const batches = new Map();
      for (const message of messages || []) {
        const {sentBy = null, sendBatchId, createdAt, title, content} = message;
        // Old manual sends used the system type with a generic message ID and no application ID.
        const legacyManual = message.type === 'system' && !message.appId && /^msg_\d+_/.test(message.id || '');
        if (!sentBy && !legacyManual) continue;
        const id = sentBy ? (sendBatchId || JSON.stringify([sentBy, createdAt, title, content])) : message.id;
        const batch = batches.get(id) || {id, sentBy, createdAt, title, content, recipientCount:0, readCount:0, unreadCount:0, recipients:[]};
        const read = message.deleted ? (message.readBeforeDelete ?? null) : message.read === true;
        batch.recipientCount++;
        if (read === true) batch.readCount++;
        if (read === false) batch.unreadCount++;
        batch.recipients.push({studentId:message.studentId, name:message.recipientName || '', read});
        batches.set(id, batch);
      }
      const history = [...batches.values()].sort((a,b) => b.createdAt - a.createdAt);
      return Response.json(history, {headers:historyHeaders});
    } catch {
      return Response.json({error:'暂时无法读取消息历史，请重试'}, {status:503, headers:historyHeaders});
    }
  }

  // GET: 获取某学生的消息
  if (request.method === 'GET') {
    try {
      if (!studentIdFromSession) return Response.json({error:'请先登录学生账号'},{status:401});
      const unreadOnly = url.searchParams.get('scope') === 'unread';
      if (!unreadOnly) {
        try{await syncFileTaskNotifications(env)}catch(e){console.error('[file task notifications]',e);}
        try{await syncRequestNotifications(env)}catch(e){console.error('[notification reconciliation]',e);}
      }
      const result = await getFileFromGitee(env, 'data/messages.json');
      const messages = (result.content || []).filter(m =>
        String(m.studentId) === studentIdFromSession && !m.deleted && (!unreadOnly || !m.read));
      messages.sort((a, b) => b.createdAt - a.createdAt);
      return Response.json(messages,{headers:{...headers,'Cache-Control':'no-store'}});
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
        if (!studentIdFromSession) return Response.json({error:'请先登录学生账号'},{status:401});
        const { messageId } = body;
        if (!messageId) return new Response(JSON.stringify({ error: '缺少messageId' }), { status: 400, headers });
        const result = await getFileFromGitee(env, 'data/messages.json');
        let messages = result.content || [];
        const sha = result.sha;
        const msg = messages.find(m => m.id === messageId && String(m.studentId) === studentIdFromSession && !m.read && !m.deleted);
        if (msg) {
          msg.read = true;
          await writeJsonToGitee(env, 'data/messages.json', messages, sha, 'mark read');
        }
        return new Response(JSON.stringify({ message: 'ok' }), { headers });
      }

      // 标记全部已读
      if (action === 'mark-all-read') {
        const studentId = studentIdFromSession;
        if (!studentId) return Response.json({error:'请先登录学生账号'},{status:401});
        const result = await getFileFromGitee(env, 'data/messages.json');
        let messages = result.content || [];
        const sha = result.sha;
        let changed = false;
        messages.forEach(m => {
          if (String(m.studentId) === studentId && !m.read && !m.deleted) {
            m.read = true;
            changed = true;
          }
        });
        if (changed) {
          await writeJsonToGitee(env, 'data/messages.json', messages, sha, 'mark all read');
        }
        return new Response(JSON.stringify({ message: 'ok' }), { headers });
      }

      const user=session?.state==='online' && session.row.kind==='admin' ? session.account : null;
      if(!user||!effectiveAdminPermissions(user,session.accounts).messagePermission)return new Response(JSON.stringify({error:'无权发送消息'}),{status:403,headers});
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
        sentBy: user.username,
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