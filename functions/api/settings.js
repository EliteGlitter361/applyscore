import { effectiveSettings, validateSchedules } from '../utils/schedules.js';
import { getFileFromGitee, writeJsonToGitee } from '../utils/gitee';

const announcementThemes = new Set(['none','meteors','ocean','bamboo','grassland','ink-landscape']);

export async function onRequest(context) {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (request.method === 'GET') {
    try {
      const result = await getFileFromGitee(env, 'data/settings.json');
      const stored = result.content || {};
      const settings = effectiveSettings(stored);
      let entryClosesAt=null;
      if(settings.enabled!==false)for(const r of stored.schedules||[]){if(!r.active||r.target!=='enabled'||r.value!==false)continue;let at;if(r.mode==='daily'){const now=Date.now(),day=new Date(now+8*3600000),[h,m]=r.at.split(':').map(Number);at=Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),h-8,m);if(at<=now)at+=86400000;}else at=Date.parse(r.at);if(at>Date.now()&&(!entryClosesAt||at<entryClosesAt))entryClosesAt=at;}
      const merged = {entryClosesAt, systemClosesAt: stored.systemClosesAt ?? null, systemClosed:settings.systemClosed, systemShutdownUpdatedAt:stored.systemShutdownUpdatedAt ?? 0,
        schedules: stored.schedules || [],
        manualEnabled: stored.enabled ?? true, manualFileUploadEnabled:stored.fileUploadEnabled ?? true, manualAnnouncementEnabled:stored.announcementEnabled ?? false,
        enabled: settings.enabled ?? true,
        manualEntryClosedShowReturn: stored.entryClosedShowReturn !== false,
        entryClosedShowReturn: settings.entryClosedShowReturn !== false,
        message: settings.message || '',
        fileUploadEnabled: settings.fileUploadEnabled ?? true,
        allowMultipleFiles: settings.allowMultipleFiles ?? true,
        fileUploadDeadline: settings.fileUploadDeadline || null,
        fileUploadDeadlineEnabled: settings.fileUploadDeadlineEnabled ?? false,
        uploadRequirementEnabled: settings.uploadRequirementEnabled ?? false,
        uploadRequirementMessage: settings.uploadRequirementMessage || '',
        maxSubmissionsPerStudent: settings.maxSubmissionsPerStudent ?? 1,
        maxFileSizeMB: settings.maxFileSizeMB ?? 20,
        announcementEnabled: settings.announcementEnabled ?? false,
        manualAnnouncementTitle: stored.announcementTitle || '系统公告',
        manualAnnouncementMessage: stored.announcementMessage || '',
        manualAnnouncementShowConfirm: stored.announcementShowConfirm !== false,
        announcementAero: settings.announcementAero === true,
        announcementTheme: announcementThemes.has(settings.announcementTheme) ? settings.announcementTheme : 'none',
        announcementTitle: settings.announcementTitle || '系统公告',
        announcementMessage: settings.announcementMessage || '',
        announcementShowConfirm: settings.announcementShowConfirm !== false,
      };
      if(new URL(request.url).searchParams.get('scope')==='shutdown'){
        const {systemClosesAt,systemClosed,systemShutdownUpdatedAt,entryClosesAt,enabled,
          manualAnnouncementMessage,announcementTitle,announcementMessage,announcementTheme,announcementAero}=merged;
        return Response.json({systemClosesAt,systemClosed,systemShutdownUpdatedAt,entryClosesAt,enabled,
          manualAnnouncementMessage,announcementTitle,announcementMessage,announcementTheme,announcementAero},{headers:{'Cache-Control':'no-store'}});
      }
      return new Response(JSON.stringify(merged), { headers });
    } catch (e) {
      // A Gitee failure is NOT an empty settings file. In particular, returning
      // enabled=true here would silently reopen a disabled application entrance.
      console.error('[settings GET]', e);
      return new Response(JSON.stringify({
        error: e?.message || 'Gitee 设置读取失败',
        ...(e?.code ? { code: e.code } : {}),
        ...(e?.missing ? { missing: e.missing } : {}),
      }), { status: e?.code === 'GITEE_CONFIG_MISSING' ? 503 : 502, headers });
    }
  }

  if (request.method === 'POST') {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.replace('Bearer ', '');
    if (!token || token !== 'fake-jwt-system') {
      return new Response(JSON.stringify({ error: '需要 system 权限' }), { status: 403, headers });
    }

    try {
      const body = await request.json();
      let currentSettings = {};
      let sha = null;
      try {
        const result = await getFileFromGitee(env, 'data/settings.json');
        currentSettings = result.content || {};
        sha = result.sha;
      } catch (e) {
        // Never overwrite an existing settings file on read/auth failures.
        throw e;
      }

      const newSettings = { ...currentSettings };
      if(body.schedules!==undefined){try{const rules=validateSchedules(body.schedules);if(body.scheduleTarget!==undefined){if(!['enabled','fileUploadEnabled','announcementEnabled'].includes(body.scheduleTarget)||rules.some(r=>r.target!==body.scheduleTarget))throw Error('定时设置目标无效');newSettings.schedules=[...(currentSettings.schedules||[]).filter(r=>r.target!==body.scheduleTarget),...rules];}else newSettings.schedules=rules}catch(e){return new Response(JSON.stringify({error:e.message}),{status:400,headers});}}
      if (body.entryClosedShowReturn !== undefined && typeof body.entryClosedShowReturn !== 'boolean') {
        return Response.json({error:'返回按钮设置必须为布尔值'},{status:400,headers});
      }
      if(body.systemClosesAt !== undefined && body.systemClosesAt !== null &&
          (!Number.isSafeInteger(body.systemClosesAt) || body.systemClosesAt <= 0 || body.systemClosesAt > 253402271999999)){
        return Response.json({error:'系统停止服务时间无效'},{status:400,headers});
      }
      if(body.announcementTheme !== undefined && !announcementThemes.has(body.announcementTheme)){
        return Response.json({error:'无效的公告主题'},{status:400,headers});
      }
      if(body.announcementAero !== undefined && typeof body.announcementAero !== 'boolean'){
        return Response.json({error:'无效的毛玻璃设置'},{status:400,headers});
      }
      const fields = [
        'announcementTheme', 'announcementAero',
        'systemClosesAt',
        'enabled', 'message',
        'entryClosedShowReturn',
        'fileUploadEnabled', 'allowMultipleFiles',
        'fileUploadDeadline', 'fileUploadDeadlineEnabled',
        'uploadRequirementEnabled', 'uploadRequirementMessage',
        'maxSubmissionsPerStudent', 'maxFileSizeMB',
        'announcementEnabled', 'announcementTitle', 'announcementMessage', 'announcementShowConfirm',
      ];
      fields.forEach(f => {
        if (body[f] !== undefined) newSettings[f] = body[f];
      });

      for(const key of ['enabled','fileUploadEnabled','announcementEnabled'])if(typeof body[key]==='boolean')newSettings.manualUpdatedAt={...(newSettings.manualUpdatedAt||{}),[key]:Date.now()};
      if(body.systemClosesAt !== undefined){
        newSettings.systemShutdownUpdatedAt=Math.max(Date.now(),Number(currentSettings.systemShutdownUpdatedAt||0)+1);
      }
      await writeJsonToGitee(env, 'data/settings.json', newSettings, sha, 'update settings');
      const effective=effectiveSettings(newSettings);
      const shutdown=body.systemClosesAt===undefined ? {} : {
        systemClosesAt:newSettings.systemClosesAt,systemShutdownUpdatedAt:newSettings.systemShutdownUpdatedAt,
        systemClosed:effective.systemClosed,announcementAero:newSettings.announcementAero===true,announcementTheme:announcementThemes.has(newSettings.announcementTheme)?newSettings.announcementTheme:"none",manualAnnouncementMessage:newSettings.announcementMessage||''
      };
      return new Response(JSON.stringify({ message: '设置已更新', ...shutdown }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: e?.code === 'GITEE_CONFIG_MISSING' ? 503 : 502, headers });
    }
  }

  return new Response('Method not allowed', { status: 405 });
}