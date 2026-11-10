const fs=require('fs'),path=require('path'),root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const api=read('functions/api/requests.js'),admin=read('admin.html'),index=read('index.html'),app=read('assets/app.js'),files=read('functions/api/files.js'),ctrl=read('assets/controllers/admin.mjs'),core=read('assets/core.css'),shell=read('assets/music-shell.js'),musicCss=read('assets/music-core.css');
for(const [name,ok] of [
 ['Gitee request task storage',api.includes('data/application-requests.json')&&api.includes('writeJsonToGitee')],
 ['server-side expiry rejection',api.includes('Date.now()>task.expiresAt')],
 ['student identity and image validation',api.includes('student-jwt-')&&api.includes('images.length')],
 ['attachment required flag',api.includes('task.attachmentRequired')],
 ['admin targeted student selection',admin.includes('requestStudentSelected')],
 ['student application form activity name',read('assigned-request.html').includes('活动名称 <span class="required">*</span>')&&read('assigned-request.html').includes('assignedPageApi.submit')],
 ['batch file deletion UI',admin.includes('批量删除')&&ctrl.includes('deleteSelectedUploads')],
 ['server-side admin validation for deletion',files.includes('getAccountJson')&&files.includes('管理员身份无效')],
 ['security center label',admin.includes('系统安全')],
 ['global theme button',app.includes('class="theme-toggle"')&&!app.includes('v-if="isAuth" type="button" class="theme-toggle"')],
 ['global dark theme variables',core.includes('html[data-theme="dark"]')]
]){if(!ok){console.error('FAIL',name);process.exitCode=1}else console.log('PASS',name)}
