import {receivesFileTask} from './file-task-access.js';
import {getFileFromGitee,writeJsonToGitee} from './gitee';
export async function syncFileTaskNotifications(env){let tasks;try{tasks=await getFileFromGitee(env,'data/file-tasks.json')}catch(e){if(String(e.message).includes('404'))return;throw e;}
 if(!tasks.content?.length)return;const students=await getFileFromGitee(env,'data/students.json');let stored;try{stored=await getFileFromGitee(env,'data/messages.json')}catch(e){if(!String(e.message).includes('404'))throw e;stored={content:[],sha:null};}
 const rows=stored.content||[],ids=new Set(rows.map(m=>m.id));let changed=false;for(const task of tasks.content)for(const student of students.content||[]){if(task.deletedAt||student.banned||!receivesFileTask(task,student.studentId))continue;const id='filetask_'+task.id+'_'+student.studentId;if(ids.has(id))continue;ids.add(id);rows.push({id,studentId:String(student.studentId),title:'新的文件上传任务：'+task.title,content:'请进入文件上传选择「'+task.title+'」提交材料。'+task.description,createdAt:task.createdAt,read:false,type:'system'});changed=true;}
 if(changed)await writeJsonToGitee(env,'data/messages.json',rows,stored.sha,'file task notifications');}
