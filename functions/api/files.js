import {receivesFileTask} from '../utils/file-task-access.js';
import { effectiveSettings } from '../utils/schedules.js';
import { getFileFromGitee, writeJsonToGitee, writeFileToGitee } from '../utils/gitee';
import { getAccountJson } from '../utils/accounts.js';

// 高效、安全的 base64 编码（分块处理，避免大字符串拼接内存溢出）
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

// 清理文件名
function sanitizeFileName(name) {
  if (!name) return 'file';
  const lastDot = name.lastIndexOf('.');
  let base = lastDot > 0 ? name.slice(0, lastDot) : name;
  const ext = lastDot > 0 ? name.slice(lastDot).toLowerCase() : '';
  base = base.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_-]/g, '_').substring(0, 40);
  if (!base) base = 'file';
  const cleanExt = ext.replace(/[^a-zA-Z0-9.]/g, '').substring(0, 10);
  return base + cleanExt;
}

// 并行上传单个文件
async function uploadOneFile(env, uploadId, file, index) {
  const safeName = sanitizeFileName(file.name);
  const finalName = `${index + 1}_${safeName}`;
  const arrayBuffer = await file.arrayBuffer();
  const base64 = arrayBufferToBase64(arrayBuffer);
  const filePath = `data/uploads/${uploadId}/${finalName}`;
  await writeFileToGitee(env, filePath, base64, null, `upload ${finalName}`);
  return { finalName, originalName: file.name, size: file.size };
}

export async function onRequest(context) {
  const { request, env } = context;
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers });

  // GET：仅授权的管理用户可以读取包含姓名、学号的上传记录。
  // 注意：legacy token 仍需整体升级为服务端签名会话；这是防止匿名枚举的临时保护。
  if (request.method === 'GET') {
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token.startsWith('fake-jwt-')) {
      return new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 401, headers });
    }
    try {
      const { content: admins } = await getAccountJson(env, 'data/adminuser.json');
      if (!(admins || []).some(a => a.username === token.slice(9)&&(a.role==='system'||a.filePermission===true||a.filePermission===1))) {
        return new Response(JSON.stringify({ error: '管理员身份无效' }), { status: 403, headers });
      }
    } catch (error) {
      return new Response(JSON.stringify({ error: '无法验证管理员身份' }), { status: 503, headers });
    }
    try {
      const result = await getFileFromGitee(env, 'data/uploads.json');
      return new Response(JSON.stringify((result.content || []).filter(upload => !upload.deletedAt)), { headers });
    } catch (e) {
      if (e.message.includes('404')) return new Response(JSON.stringify([]), { headers });
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // POST：上传文件（并行优化版）
  if (request.method === 'POST') {
    try {
      // ===== 1. 读取设置 =====
      let settings = {};
      try {
        const settingsResult = await getFileFromGitee(env, 'data/settings.json');
        settings = effectiveSettings(settingsResult.content || {});
      } catch (e) { throw e; }

      const formData = await request.formData();
      if(context.data?.accountSession?.row?.kind!=='student'||context.data.accountSession.row.id!==String(formData.get('studentId')||''))return Response.json({error:'请使用本人学生账号登录'},{status:403});
      const taskId=String(formData.get('taskId')||'');let tasks=[];try{tasks=(await getFileFromGitee(env,'data/file-tasks.json')).content||[]}catch(e){if(!String(e.message).includes('404'))throw e;}
      if(tasks.length||taskId){const task=tasks.find(t=>t.id===taskId);if(!task||task.deletedAt)return Response.json({error:'请选择有效的上传任务'},{status:400});if(settings.fileUploadEnabled===false)return Response.json({error:'文件上传总入口已关闭'},{status:403});const sid=String(formData.get('studentId')||'');if(request.headers.get('Authorization')!=='Bearer student-jwt-'+sid||!receivesFileTask(task,sid))return Response.json({error:'此任务未发送给你或登录已失效'},{status:403});settings={...settings,...task};}
      if (settings.fileUploadEnabled === false) {
        return new Response(JSON.stringify({ error: '文件上传功能已关闭' }), { status: 403, headers });
      }

      if (settings.fileUploadDeadlineEnabled && settings.fileUploadDeadline) {
        if (Date.now() > settings.fileUploadDeadline) {
          return new Response(JSON.stringify({ error: '文件上传已截止' }), { status: 403, headers });
        }
      }

      const maxMB = typeof settings.maxFileSizeMB === 'number' && settings.maxFileSizeMB > 0
        ? settings.maxFileSizeMB : 20;
      const maxBytes = maxMB * 1024 * 1024;

      // ===== 2. 解析表单 =====
      const name = formData.get('name')?.trim();
      const studentId = formData.get('studentId')?.trim();
      const files = formData.getAll('files') || [];

      if (!name || !studentId) {
        return new Response(JSON.stringify({ error: '姓名和学号不能为空' }), { status: 400, headers });
      }
      if (files.length === 0) {
        return new Response(JSON.stringify({ error: '请至少上传一个文件' }), { status: 400, headers });
      }
      if (settings.allowMultipleFiles === false && files.length > 1) {
        return new Response(JSON.stringify({ error: '当前只允许上传一个文件' }), { status: 400, headers });
      }

      // 检查文件大小
      for (const file of files) {
        if (!file || !file.size) continue;
        if (file.size > maxBytes) {
          return new Response(JSON.stringify({
            error: `文件 "${file.name}" 超过 ${maxMB}MB 限制`
          }), { status: 400, headers });
        }
      }

      // ===== 3. 校验学生身份 =====
      let students = [];
      try {
        const studentResult = await getFileFromGitee(env, 'data/students.json');
        students = studentResult.content || [];
      } catch (e) { throw e; }
      const validStudent = students.find(s => s.name === name && s.studentId === studentId);
      if (!validStudent) {
        return new Response(JSON.stringify({ error: '姓名与学号不匹配，或不在学生名单中' }), { status: 403, headers });
      }
      if (validStudent.banned) {
        return new Response(JSON.stringify({ error: '您的账号已被封禁，无法上传' }), { status: 403, headers });
      }

      // ===== 4. 提交次数校验 =====
      let uploads = [];
      try {
        const result = await getFileFromGitee(env, 'data/uploads.json');
        uploads = result.content || [];
      } catch (e) {
        if (!e.message.includes('404')) throw e;
      }

      const maxSub = taskId ? 1 : (Number(settings.maxSubmissionsPerStudent) || 1);
      const limitReached = rows => rows.filter(u => String(u.studentId) === studentId && (u.taskId || '') === taskId).length >= maxSub;
      const limitResponse = () => Response.json({
        code:'UPLOAD_LIMIT_REACHED',error:`此任务已达到提交上限（${maxSub} 次），如需重新提交请联系管理员。`
      }, {status:409, headers});

      if (limitReached(uploads)) return limitResponse();

      // ===== 5. 并行上传所有文件 =====
      const uploadId = Date.now() + '_' + Math.random().toString(36).substr(2, 6) + '_' + studentId;
      const validFiles = files.filter(f => f && f.name);

      // 使用 Promise.allSettled 并行上传，即使个别文件失败，其他文件继续
      const results = await Promise.allSettled(
        validFiles.map((file, i) => uploadOneFile(env, uploadId, file, i))
      );

      const savedFiles = [];
      const failedFiles = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          savedFiles.push(r.value.finalName);
        } else {
          console.error(`文件 ${validFiles[i].name} 上传失败:`, r.reason);
          failedFiles.push({
            name: validFiles[i].name,
            error: r.reason?.message || '未知错误',
          });
        }
      });

      // 所有文件都失败
      if (savedFiles.length === 0) {
        return new Response(JSON.stringify({
          error: `所有文件上传失败：${failedFiles.map(f => f.name).join(', ')}`,
          failedFiles,
        }), { status: 500, headers });
      }

      // ===== 6. 保存元数据 =====
      const newUpload = {
        id: uploadId,
        name,
        studentId,
        files: savedFiles,
        uploadedAt: Date.now(),
        taskId,
      };

      // Recheck the same SHA snapshot that will be used for the conditional write.
      for (let attempt = 0; ; attempt++) {
        const latest = await getFileFromGitee(env, 'data/uploads.json');
        const rows = latest.content || [];
        if (rows.some(u => u.id === uploadId)) break;
        if (limitReached(rows)) return limitResponse();
        try {
          await writeJsonToGitee(env, 'data/uploads.json', [...rows, newUpload], latest.sha, `add upload ${uploadId}`);
          break;
        } catch (error) {
          if (attempt >= 2) throw error;
          const current = await getFileFromGitee(env, 'data/uploads.json');
          if (current.sha === latest.sha) throw error;
        }
      }

      // 部分失败时返回警告
      if (failedFiles.length > 0) {
        return new Response(JSON.stringify({
          message: `部分文件上传成功（${savedFiles.length} 个），${failedFiles.length} 个失败`,
          upload: newUpload,
          failedFiles,
        }), { status: 201, headers });
      }

      return new Response(JSON.stringify({ message: '上传成功', upload: newUpload }), { status: 201, headers });
    } catch (e) {
      console.error('上传处理异常:', e);
      return new Response(JSON.stringify({ error: e.message || '服务器错误' }), { status: 500, headers });
    }
  }

  // DELETE：删除上传记录
  if (request.method === 'DELETE') {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.replace('Bearer ', '');
    if (!token.startsWith('fake-jwt-')) {
      return new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 403, headers });
    }
    try { const { content: admins } = await getAccountJson(env, 'data/adminuser.json'); const username = token.slice(9); if (!(admins || []).some(a => a.username === username&&a.role==='system')) return new Response(JSON.stringify({ error: '管理员身份无效' }), { status: 403, headers }); } catch (e) { return new Response(JSON.stringify({ error: '无法验证管理员身份：' + e.message }), { status: 503, headers }); }

    try {
      const { ids } = await request.json();
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return new Response(JSON.stringify({ error: '请提供要删除的 IDs 数组' }), { status: 400, headers });
      }
      const result = await getFileFromGitee(env, 'data/uploads.json');
      let uploads = result.content || [];
      const sha = result.sha;
      const deleted = uploads.filter(u => ids.includes(u.id) && !u.deletedAt);
      const deletedAt = Date.now();
      // Keep submission history for quota checks even when the file listing is removed.
      const filtered = uploads.map(u => deleted.includes(u) ? {...u, files: [], deletedAt} : u);
      if (!deleted.length) {
        return new Response(JSON.stringify({ error: '没有找到可删除的记录' }), { status: 404, headers });
      }
      await writeJsonToGitee(env, 'data/uploads.json', filtered, sha, `delete uploads ${ids.join(',')}`);
      return new Response(JSON.stringify({ message: '删除成功' }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  return new Response('Method not allowed', { status: 405, headers });
}