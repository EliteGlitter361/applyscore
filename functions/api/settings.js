import { getFileFromGitee, writeJsonToGitee } from '../utils/gitee';

export async function onRequest(context) {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (request.method === 'GET') {
    try {
      const result = await getFileFromGitee(env, 'data/settings.json');
      const settings = result.content || {};
      const merged = {
        enabled: settings.enabled ?? true,
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
        announcementTitle: settings.announcementTitle || '系统公告',
        announcementMessage: settings.announcementMessage || '',
      };
      return new Response(JSON.stringify(merged), { headers });
    } catch (e) {
      return new Response(JSON.stringify({
        enabled: true,
        message: '',
        fileUploadEnabled: true,
        allowMultipleFiles: true,
        fileUploadDeadline: null,
        fileUploadDeadlineEnabled: false,
        uploadRequirementEnabled: false,
        uploadRequirementMessage: '',
        maxSubmissionsPerStudent: 1,
        maxFileSizeMB: 20,
        announcementEnabled: false,
        announcementTitle: '系统公告',
        announcementMessage: '',
      }), { headers });
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
      } catch (e) {}

      const newSettings = { ...currentSettings };
      const fields = [
        'enabled', 'message',
        'fileUploadEnabled', 'allowMultipleFiles',
        'fileUploadDeadline', 'fileUploadDeadlineEnabled',
        'uploadRequirementEnabled', 'uploadRequirementMessage',
        'maxSubmissionsPerStudent', 'maxFileSizeMB',
        'announcementEnabled', 'announcementTitle', 'announcementMessage',
      ];
      fields.forEach(f => {
        if (body[f] !== undefined) newSettings[f] = body[f];
      });

      await writeJsonToGitee(env, 'data/settings.json', newSettings, sha, 'update settings');
      return new Response(JSON.stringify({ message: '设置已更新' }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
    }
  }

  return new Response('Method not allowed', { status: 405 });
}