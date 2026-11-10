const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
(async()=>{
const src=fs.readFileSync(path.resolve(__dirname,'../assets/controllers/detail.mjs'),'utf8').replace('export function mount','function mount');
for(const status of ['approved','needs_fix','pending']){
 const appVm={detailForm:{},detailPreviews:[]};const task={id:'r1',title:'读书笔记',attachmentRequired:true,submission:{studentId:'1',name:'甲',activityName:'读书笔记',activityTime:'2026-11-02T10:00',location:'图书馆',participants:'甲',status,files:[]}};
 const ctx={console,URL,URLSearchParams,location:{search:'?id=assigned%3Ar1%3A1'},document:{title:''},localStorage:{getItem:k=>k==='studentToken'?(status!=='approved'?'student-jwt-1':''):JSON.stringify({studentId:'1'})},window:{apiCache:{get:async url=>url.includes('scope=published')?(status==='approved'?[task]:[]):[task]},syncBus:{on:()=>()=>{}},addEventListener(){},removeEventListener(){}},setTimeout,crypto};vm.createContext(ctx);vm.runInContext(src,ctx);const cleanup=ctx.mount(appVm);await new Promise(setImmediate);assert.equal(appVm.detailLoading,false);assert.equal(appVm.detailApp.versionName,'读书笔记');assert.equal(appVm.detailApp.packageName,'1');assert.equal(appVm.detailApp.publisher,'2026-11-02 10:00');assert.equal(appVm.detailCanEdit,status==='needs_fix');assert.equal(appVm.detailForm.location,'图书馆');cleanup();
}
console.log('PASS shared detail controller: public approved assigned application and authenticated needs-fix editing');
})().catch(e=>{console.error(e);process.exitCode=1});
