import {getFileFromGitee,writeJsonToGitee} from './gitee';
export async function syncRequestNotifications(env,now=Date.now()){
 const tasks=await getFileFromGitee(env,'data/application-requests.json');
 let stored;try{stored=await getFileFromGitee(env,'data/messages.json')}catch(e){if(!String(e.message).includes('404'))throw e;stored={content:[],sha:null};}
 const rows=stored.content||[],ids=new Set(rows.map(m=>m.id));let changed=false;
 for(const task of tasks.content||[])for(const sid of task.studentIds||[]){
 const add=(kind,title,content,createdAt)=>{const id='assigned_'+kind+'_'+task.id+'_'+sid;if(ids.has(id))return;ids.add(id);rows.push({id,studentId:String(sid),title,content,createdAt,read:false,type:'assigned',taskId:task.id});changed=true;};
 add('received','收到指定申请：'+task.title,'管理员已向你发送指定申请「'+task.title+'」，请在学分总览的管理员发放的申请中填写。'+(task.expiresAt?'截止时间：'+new Date(task.expiresAt).toISOString()+'（UTC）。':''),task.createdAt||now);
 if(task.expiresAt&&now>=task.expiresAt&&!(task.submissions||[]).some(s=>String(s.studentId)===String(sid)))add('expired','指定申请已截止：'+task.title,'指定申请「'+task.title+'」已截止，你尚未提交。请联系管理员。',task.expiresAt);
 }
 if(changed)await writeJsonToGitee(env,'data/messages.json',rows,stored.sha,'sync assigned notifications');
 return rows;
}
