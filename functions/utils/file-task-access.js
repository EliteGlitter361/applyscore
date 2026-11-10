export const receivesFileTask=(task,sid)=>task.audience!=='selected'||(Array.isArray(task.studentIds)?task.studentIds:[]).some(id=>String(id).trim()===String(sid).trim());
