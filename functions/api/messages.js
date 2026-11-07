import {syncFileTaskNotifications} from '../utils/file-task-notifications.js';
import {syncRequestNotifications} from '../utils/request-notifications.js';
import { getAccountJson } from '../utils/accounts.js';
import { getFileFromGitee, writeJsonToGitee } from '../utils/gitee';

export async function onRequest(context) {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  try{await syncFileTaskNotifications(env)}catch(e){console.error('[file task notifications]',e);}
  try{await syncRequestNotifications(env)}catch(e){console.error('[notification reconciliation]',e);}

  if(request.method==='DELETE'){
    try{const token=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');if(!token.startsWith('student-jwt-'))return Response.json({error:'请先登录学生账号'},{status:401});const sid=token.slice(12),students=(await getFileFromGitee(env,'data/students.json')).content||[];if(!students.some(s=>String(s.studentId)===sid&&!s.banned))return Response.json({error:'学生账号不可用'},{status:403});const b=await request.json();if(b.all!==true&&(!Array.isArray(b.ids)||!b.ids.length))return Response.json({error:'请选择要删除的消息'},{status:400});let stored;try{stored=await getFileFromGitee(env,'data/messages.json')}catch(e){if(!String(e.message).includes('404'))throw e;stored={content:[],sha:null}}const ids=new Set((b.ids||[]).map(String));let count=0;for(const m of stored.content||[]){if(String(m.studentId)===sid&&!m.deleted&&(b.all===true||ids.has(String(m.id)))){m.deleted=true;m.read=true;count++;}}if(count)await writeJsonToGitee(env,'data/messages.json',stored.content,stored.sha,'student delete messages');return Response.json({message:b.all===true?'消息已清空':'消息已删除',count});}catch(e){return Response.json({error:e.message},{status:500})}
  }

  // GET: 获取某学生的消息
  if (request.method === 'GET') {
    try {
      const studentId = url.searchParams.get('studentId');
      const result = await getFileFromGitee(env, 'data/messages.json');
      let messages = (result.content || []).filter(m=>!m.deleted);
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

      const token=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
      const admins=(await getAccountJson(env,'data/adminuser.json')).content||[];
      const user=token.startsWith('fake-jwt-')?admins.find(a=>a.username===token.slice(9)):null;
      if(!user||!(user.role==='system'||user.messagePermission===true||user.messagePermission===1))return new Response(JSON.stringify({error:'无权发送消息'}),{status:403,headers});
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