import { getFileFromGitee, writeJsonToGitee } from '../utils/gitee';

export async function onRequest(context) {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  if (!token || token !== 'fake-jwt-system') {
    return new Response(JSON.stringify({ error: '需要 system 权限' }), { status: 403, headers });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if(request.method==='GET'&&action==='garbage'){
    try{
      const {content}=await getFileFromGitee(env,'data/app.json');
      const seen=new Set(),findings=[];
      for(const app of content||[]){
        const reasons=[],title=String(app.versionName||'').trim(),student=String(app.packageName||'').trim();
        if(!title||!student||!String(app.name||'').trim())reasons.push('申请信息缺失');
        const text=[title,app.participants].join(' ');
        if(/<script\b|javascript:|<iframe\b/i.test(text)||(text.match(/https?:\/\//gi)||[]).length>=3)reasons.push('疑似广告或脚本内容');
        const key=student+'|'+title.toLowerCase();
        if(title&&student&&seen.has(key))reasons.push('同一学号和活动名称重复');
        seen.add(key);
        if(reasons.length)findings.push({id:app.id,title:title||'未命名',reasons});
      }
      return Response.json({count:findings.length,findings:findings.slice(0,100)});
    }catch{return Response.json({error:'垃圾检测暂不可用'},{status:503});}
  }

  // 扫描冗余数据
  if (request.method === 'GET' && action === 'scan') {
    try {
      const result = await getFileFromGitee(env, 'data/app.json');
      const apps = result.content || [];
      const validStatuses = ['approved', 'needs_fix', 'pending'];
      const redundant = apps.filter(a => !validStatuses.includes(a.status));

      // 计算 JSON 大小
      const jsonStr = JSON.stringify(redundant);
      const sizeBytes = new Blob([jsonStr]).size;
      // 计算描述占用（每条数据的字段数量作为参考）
      const totalBytes = apps.length > 0 ? new Blob([JSON.stringify(apps)]).size : 0;
      const validBytes = apps.length - redundant.length > 0
        ? new Blob([JSON.stringify(apps.filter(a => validStatuses.includes(a.status)))]).size
        : 0;

      return new Response(JSON.stringify({
        count: redundant.length,
        totalCount: apps.length,
        sizeBytes: sizeBytes,
        totalSizeBytes: totalBytes,
        validSizeBytes: validBytes,
        apps: redundant.map(a => ({
          id: a.id,
          name: a.name,
          packageName: a.packageName,
          versionName: a.versionName,
          status: a.status,
          createdAt: a.createdAt,
        })),
      }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  // 清理冗余数据
  if (request.method === 'POST' && action === 'clean') {
    try {
      const result = await getFileFromGitee(env, 'data/app.json');
      const apps = result.content || [];
      const sha = result.sha;
      const validStatuses = ['approved', 'needs_fix', 'pending'];
      const filtered = apps.filter(a => validStatuses.includes(a.status));
      const removed = apps.length - filtered.length;

      if (removed > 0) {
        await writeJsonToGitee(env, 'data/app.json', filtered, sha, `clean redundant data (${removed} items)`);
      }

      return new Response(JSON.stringify({
        message: `已清理 ${removed} 条冗余数据`,
        removed: removed,
      }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  return new Response('Method not allowed', { status: 405 });
}