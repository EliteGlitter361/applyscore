const targets=['enabled','fileUploadEnabled','announcementEnabled'];
export function validateSchedules(value){
 if(!Array.isArray(value)||value.length>30)throw Error('定时规则最多30条');
 return value.map(r=>{if(!targets.includes(r.target)||!['once','daily'].includes(r.mode)||typeof r.value!=='boolean')throw Error('定时规则无效');
 if(r.mode==='daily'?!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.at):!Number.isFinite(Date.parse(r.at)))throw Error('定时时间无效');
 return {target:r.target,mode:r.mode,at:r.at,value:r.value,active:r.active!==false};});
}
export function effectiveSettings(settings,now=Date.now()){
 const result={...settings};
 for(const target of targets){let latest=-Infinity;
 for(const r of settings.schedules||[]){if(!r.active||r.target!==target)continue;let time;
 if(r.mode==='daily'){const local=new Date(now+8*3600000);const [h,m]=r.at.split(':').map(Number);time=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate(),h-8,m);if(time>now)time-=86400000;}
 else time=Date.parse(r.at);
 if(time<=Number(settings.manualUpdatedAt?.[target]||0))continue;
 if(settings[target]===false&&!settings.manualUpdatedAt?.[target]&&r.value===true)continue;
 if(time<=now&&time>=latest){latest=time;result[target]=r.value;}}
 }
 const closesAt = Number(settings.systemClosesAt);
 result.systemClosed = closesAt > 0 && now >= closesAt;
 if(result.systemClosed) Object.assign(result,{
   enabled:false, fileUploadEnabled:false, entryClosedShowReturn:false,
   announcementEnabled:true, announcementShowConfirm:false,
   announcementTitle:'学分服务中心已停止服务',
   announcementMessage:String(settings.announcementMessage||'').trim() || '学分服务中心已停止服务，请留意后续通知。',
   message:'学分服务中心已停止服务。'
 });
 return result;
}
