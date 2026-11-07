import { effectiveSettings } from '../utils/schedules.js';
import { getFileFromGitee, writeJsonToGitee, writeFileToGitee } from '../utils/gitee';

async function uploadScreenshots(env, appId, files) {
  const names = [];
  for (const file of files) {
    if (!file || !file.name) continue;
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
    const base64 = btoa(binary);
    const safeName = encodeURIComponent(file.name);
    const filePath = `data/appdata/${appId}/${safeName}`;
    await writeFileToGitee(env, filePath, base64, null, `upload ${safeName}`);
    names.push(safeName);
  }
  return names;
}

export async function onRequest(context) {
  const { request, env } = context;
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers });

  /* ===== GET ===== */
  if (request.method === 'GET') {
    try {
      const result = await getFileFromGitee(env, 'data/app.json');
      return new Response(JSON.stringify(result.content || []), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message, ...(e.code ? {code: e.code, missing: e.missing} : {}) }), { status: e.code === 'GITEE_CONFIG_MISSING' ? 503 : 500, headers });
    }
  }

  if(['POST','PUT'].includes(request.method)){
    try{const stored=(await getFileFromGitee(env,'data/settings.json')).content;if(!stored||typeof stored.enabled!=='boolean')return Response.json({error:'暂时无法确认学分申请入口状态'},{status:503});if(effectiveSettings(stored).enabled===false)return Response.json({error:stored.message||'学分申请入口已关闭'},{status:403});}catch(e){return Response.json({error:'暂时无法确认学分申请入口状态，请稍后重试'},{status:503});}
  }
  /* ===== POST：新建申请 ===== */
  if (request.method === 'POST') {
    try {
      const formData = await request.formData();
      const name = formData.get('name')?.trim();
      const packageName = formData.get('packageName')?.trim();
      const versionName = formData.get('versionName')?.trim();
      const submittedAt=Date.now();const publisher=new Date(submittedAt+8*3600000).toISOString().slice(0,16).replace('T',' ');
      const participantIds = [...new Set(formData.getAll('participantIds'))];
      const screenshotFiles = formData.getAll('screenshots') || [];

      if(context.data?.accountSession?.row?.id!==packageName||context.data?.accountSession?.row?.kind!=='student')return Response.json({error:'请使用本人学生账号登录'},{status:403});
      if (!name || !packageName || !versionName || !publisher) {
        return new Response(JSON.stringify({ error: '缺少必填字段' }), { status: 400, headers });
      }

      let students = [];
      try {
        const studentResult = await getFileFromGitee(env, 'data/students.json');
        students = studentResult.content || [];
      } catch (e) {
        if (!e.message.includes('404')) throw e;
      }
      const validStudent = students.find(s => s.name === name && s.studentId === packageName);
      if (!validStudent) {
        return new Response(JSON.stringify({
          error: '姓名与学号不匹配，或您不在学生名单中，请联系管理员添加。'
        }), { status: 403, headers });
      }
      if (validStudent.banned) {
        return new Response(JSON.stringify({
          error: '您的账号已被封禁，无法提交申请。如有疑问请联系管理员。'
        }), { status: 403, headers });
      }

      const roster = new Map(students.map(s => [String(s.studentId), s.name]));
      if (participantIds.some(id => typeof id !== 'string' || !roster.has(id))) {
        return Response.json({error:'参与名单已更新，请刷新后重新选择'},{status:400});
      }
      const participants = participantIds.length
        ? participantIds.map(id => roster.get(id)).join('、')
        : (formData.get('participants')?.trim() || '');
      const participantCount = participantIds.length || (participants ? null : 0);

      const id = Date.now() + '_' + Math.random().toString(36).substr(2, 6) + '_' + packageName;
      const screenshotNames = await uploadScreenshots(env, id, screenshotFiles);

      const newApp = {
        id, name, packageName, versionName, publisher, participants, participantCount,
        screenshots: screenshotNames,
        status: 'pending',
        createdAt: submittedAt,
        submittedAt,
      };

      let apps = [], sha = null;
      try {
        const result = await getFileFromGitee(env, 'data/app.json');
        apps = result.content || [];
        sha = result.sha;
      } catch (e) {
        if (!e.message.includes('404')) throw e;
      }
      apps.push(newApp);
      await writeJsonToGitee(env, 'data/app.json', apps, sha, `add app ${id}`);
      return new Response(JSON.stringify({ message: '提交成功，等待审核', app: newApp }), { status: 201, headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message, ...(e.code ? {code: e.code, missing: e.missing} : {}) }), { status: e.code === 'GITEE_CONFIG_MISSING' ? 503 : 500, headers });
    }
  }

  /* ===== PUT：学生修改被驳回的申请 ===== */
  if (request.method === 'PUT') {
    try {
      const formData = await request.formData();
      const id = formData.get('id')?.trim();
      const studentId = formData.get('studentId')?.trim();
      const versionName = formData.get('versionName')?.trim();
      const submittedAt=Date.now();const publisher=new Date(submittedAt+8*3600000).toISOString().slice(0,16).replace('T',' ');
      const participants = formData.get('participants')?.trim() || '';
      const screenshotFiles = formData.getAll('screenshots') || [];

      if(context.data?.accountSession?.row?.id!==studentId||context.data?.accountSession?.row?.kind!=='student')return Response.json({error:'请使用本人学生账号登录'},{status:403});
      if (!id || !studentId || !versionName || !publisher) {
        return new Response(JSON.stringify({ error: '缺少必填字段' }), { status: 400, headers });
      }

      const result = await getFileFromGitee(env, 'data/app.json');
      const apps = result.content || [];
      const sha = result.sha;
      const idx = apps.findIndex(a => a.id === id);
      if (idx === -1) {
        return new Response(JSON.stringify({ error: '申请不存在' }), { status: 404, headers });
      }

      const app = apps[idx];
      if (app.packageName !== studentId) {
        return new Response(JSON.stringify({ error: '无权修改此申请' }), { status: 403, headers });
      }
      if (app.status !== 'needs_fix') {
        return new Response(JSON.stringify({ error: '只有被驳回修改的申请才能重新提交' }), { status: 400, headers });
      }

      let newScreenshots = app.screenshots || [];
      if (screenshotFiles.length > 0) {
        newScreenshots = await uploadScreenshots(env, id, screenshotFiles);
      }

      apps[idx] = {
        ...app,
        versionName,
        publisher,
        participants,
        participantCount: participants === app.participants ? app.participantCount : null,
        screenshots: newScreenshots,
        status: 'pending',
        rejectReason: null,
        submittedAt,
        updatedAt: submittedAt,
      };

      await writeJsonToGitee(env, 'data/app.json', apps, sha, `modify app ${id}`);
      return new Response(JSON.stringify({ message: '修改成功，等待审核', app: apps[idx] }), { status: 200, headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message, ...(e.code ? {code: e.code, missing: e.missing} : {}) }), { status: e.code === 'GITEE_CONFIG_MISSING' ? 503 : 500, headers });
    }
  }

  /* ===== DELETE：学生取消 / 管理员批量删除 ===== */
  if (request.method === 'DELETE') {
    try {
      const body = await request.json();

      // 学生取消自己的申请
      if (body.id && body.studentId && !Array.isArray(body.ids)) {
        if(context.data?.accountSession?.row?.id!==String(body.studentId)||context.data?.accountSession?.row?.kind!=='student')return Response.json({error:'请使用本人学生账号登录'},{status:403});
        const result = await getFileFromGitee(env, 'data/app.json');
        const apps = result.content || [];
        const sha = result.sha;
        const app = apps.find(a => a.id === body.id);
        if (!app) {
          return new Response(JSON.stringify({ error: '申请不存在' }), { status: 404, headers });
        }
        if (app.packageName !== body.studentId) {
          return new Response(JSON.stringify({ error: '无权删除此申请' }), { status: 403, headers });
        }

        const filtered = apps.filter(a => a.id !== body.id);
        await writeJsonToGitee(env, 'data/app.json', filtered, sha, `cancel app ${body.id}`);
        return new Response(JSON.stringify({ message: '已取消申请' }), { headers });
      }

      // 管理员批量删除
      const admin=context.data?.accountSession?.account;
      if(context.data?.accountSession?.row?.kind!=='admin'||!(admin?.role==='system'||[true,1,'1'].includes(admin?.auditPermission)))return Response.json({error:'没有审核管理权限'},{status:403});
      const { ids } = body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return new Response(JSON.stringify({ error: '请提供要删除的 IDs 数组或 {id, studentId}' }), { status: 400, headers });
      }
      const result = await getFileFromGitee(env, 'data/app.json');
      const apps = result.content || [];
      const sha = result.sha;
      const filtered = apps.filter(a => !ids.includes(a.id));
      if (filtered.length === apps.length) {
        return new Response(JSON.stringify({ error: '没有找到可删除的申请' }), { status: 404, headers });
      }
      await writeJsonToGitee(env, 'data/app.json', filtered, sha, `permanently delete ${ids.join(',')}`);
      return new Response(JSON.stringify({ message: '永久删除成功' }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message, ...(e.code ? {code: e.code, missing: e.missing} : {}) }), { status: e.code === 'GITEE_CONFIG_MISSING' ? 503 : 500, headers });
    }
  }

  return new Response('Method not allowed', { status: 405, headers });
}