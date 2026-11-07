import {getAccountJson} from '../utils/accounts.js';
import {receivesFileTask} from '../utils/file-task-access.js';
import {getFileFromGitee,writeJsonToGitee} from '../utils/gitee';
import {syncFileTaskNotifications} from '../utils/file-task-notifications.js';
export async function onRequest({request,env,data:contextData}){try{
 const token=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
 if(request.method==='GET'&&token==='fake-jwt-system'&&new URL(request.url).searchParams.get('scope')==='students'){
   const students=(await getFileFromGitee(env,'data/students.json')).content||[];
   return Response.json(students.filter(s=>!s.banned).map(s=>({studentId:String(s.studentId),name:s.name})));
 }
 let data={content:[],sha:null};try{data=await getFileFromGitee(env,'data/file-tasks.json')}catch(e){if(!String(e.message).includes('404'))throw e;}
 if(request.method==='GET'){
 const session=contextData?.accountSession;
 if(token==='fake-jwt-system')return Response.json((data.content||[]).filter(t=>!t.deletedAt),{headers:{'Cache-Control':'no-store'}});
 if(token.startsWith('fake-jwt-')){
   const username=token.slice(9);
   const admin=session?.state==='online'&&session.row.kind==='admin'&&session.row.id===username
     ?session.account:(await getAccountJson(env,'data/adminuser.json')).content?.find(a=>a.username===username);
   if(!admin||!(admin.role==='system'||admin.filePermission===true||admin.filePermission===1))return Response.json({error:'没有文件查看权限'},{status:403});
   return Response.json((data.content||[]).filter(t=>!t.deletedAt),{headers:{'Cache-Control':'no-store'}});
 }
 if(!token.startsWith('student-jwt-'))return Response.json({error:'请先登录'},{status:401});
 const sid=token.slice(12);
 const student=session?.state==='online'&&session.row.kind==='student'&&session.row.id===sid
   ?session.account:(await getFileFromGitee(env,'data/students.json')).content?.find(s=>String(s.studentId)===sid);
 if(!student||student.banned)return Response.json({error:'学生账号不可用'},{status:403});
 const uploads=(await getFileFromGitee(env,'data/uploads.json')).content||[];
 const submitted=new Set(uploads.filter(u=>String(u.studentId)===sid).map(u=>u.taskId));
 return Response.json((data.content||[]).filter(t=>receivesFileTask(t,sid)&&!(t.dismissedStudentIds||[]).includes(sid)).map(({studentIds,dismissedStudentIds,...task})=>({...task,submitted:submitted.has(task.id)})),{headers:{'Cache-Control':'no-store'}});
 }
 if(request.method==='DELETE'){
 const token=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');const b=await request.json();
 if(Array.isArray(b.ids)){
 if(token!=='fake-jwt-system')return Response.json({error:'需要system权限'},{status:403});const ids=[...new Set(b.ids)];if(!ids.length||ids.some(id=>typeof id!=='string'))return Response.json({error:'请选择有效任务'},{status:400});const rows=data.content||[];if(ids.some(id=>!rows.some(t=>t.id===id)))return Response.json({error:'部分任务不存在，请刷新后重试'},{status:404});const now=Date.now();for(const t of rows)if(ids.includes(t.id)){t.deletedAt=t.deletedAt||now;t.fileUploadEnabled=false;}await writeJsonToGitee(env,'data/file-tasks.json',rows,data.sha,'batch delete file tasks');return Response.json({message:'已删除 '+ids.length+' 个任务',count:ids.length});
 }
 const rows=data.content||[],task=rows.find(t=>t.id===b.id);if(!task)return Response.json({error:'任务不存在'},{status:404});
 if(token==='fake-jwt-system'){task.deletedAt=task.deletedAt||Date.now();task.fileUploadEnabled=false;}
 else{if(!token.startsWith('student-jwt-'))return Response.json({error:'没有删除任务权限'},{status:403});const sid=token.slice(12),students=(await getFileFromGitee(env,'data/students.json')).content||[];if(!students.some(s=>String(s.studentId)===sid&&!s.banned)||!receivesFileTask(task,sid))return Response.json({error:'无权操作此任务'},{status:403});if(!task.deletedAt&&task.fileUploadEnabled!==false&&!(task.fileUploadDeadlineEnabled&&Number(task.fileUploadDeadline)<=Date.now()))return Response.json({error:'只能删除已结束的任务'},{status:409});task.dismissedStudentIds=[...new Set([...(task.dismissedStudentIds||[]),sid])];}
 await writeJsonToGitee(env,'data/file-tasks.json',rows,data.sha,'delete file task');return Response.json({message:'任务已删除'});
 }
 if(!['POST','PUT'].includes(request.method))return new Response('Method not allowed',{status:405});
 if(request.headers.get('Authorization')!=='Bearer fake-jwt-system')return Response.json({error:'需要system权限'},{status:403});
 const b=await request.json(),title=String(b.title||'').trim();if(!title||title.length>100)return Response.json({error:'请填写任务名称（最多100字）'},{status:400});
 const maxMB=Number(b.maxFileSizeMB),maxSub=Number(b.maxSubmissionsPerStudent);if(!Number.isFinite(maxMB)||maxMB<=0||maxMB>100||!Number.isInteger(maxSub)||maxSub<1)return Response.json({error:'文件限制须为1至100MB，提交次数须为正整数'},{status:400});
 if(b.fileUploadDeadlineEnabled&&(!Number.isFinite(Number(b.fileUploadDeadline))||Number(b.fileUploadDeadline)<=Date.now()))return Response.json({error:'截止时间必须晚于当前时间'},{status:400});
 const audience=b.audience===undefined?((data.content||[]).find(t=>t.id===b.id)?.audience||'all'):b.audience;if(!['all','selected'].includes(audience))return Response.json({error:'接收范围无效'},{status:400});const studentIds=audience==='selected'?[...new Set((b.studentIds||[]).map(String))]:[];
 if(audience==='selected'){const students=(await getFileFromGitee(env,'data/students.json')).content||[];if(!studentIds.length||studentIds.some(id=>!students.some(s=>String(s.studentId)===id&&!s.banned)))return Response.json({error:'请选择有效的接收学生'},{status:400});}
 const requirementEnabled=b.uploadRequirementEnabled===true,requirementMessage=String(b.uploadRequirementMessage||'').trim();if(requirementMessage.length>4000||(requirementEnabled&&!requirementMessage))return Response.json({error:'请填写上传要求（最多4000字）'},{status:400});
 const rows=data.content||[];let task=rows.find(t=>t.id===b.id);if(request.method==='PUT'&&(!task||task.deletedAt))return Response.json({error:'任务不存在'},{status:404});
 const fresh=!task;if(!task){task={id:'filetask_'+Date.now()+'_'+Math.random().toString(36).slice(2,8),createdAt:Date.now()};rows.push(task);}
 Object.assign(task,{uploadRequirementEnabled:requirementEnabled,uploadRequirementMessage:requirementMessage,audience,studentIds,title,description:String(b.description||'').slice(0,3000),fileUploadEnabled:b.fileUploadEnabled!==false,allowMultipleFiles:b.allowMultipleFiles!==false,maxFileSizeMB:maxMB,maxSubmissionsPerStudent:1,fileUploadDeadlineEnabled:!!b.fileUploadDeadlineEnabled,fileUploadDeadline:b.fileUploadDeadlineEnabled?Number(b.fileUploadDeadline):null});
 await writeJsonToGitee(env,'data/file-tasks.json',rows,data.sha,'save file task');let warning='';try{await syncFileTaskNotifications(env)}catch(e){console.error(e);warning='，通知将在读取消息时补齐';}
 return Response.json({message:(fresh?'任务已发布':'任务已保存')+warning,task});
 }catch(e){return Response.json({error:e.message},{status:502})}}
