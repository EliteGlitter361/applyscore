const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(__dirname+'/../assets/music-shell.js','utf8');
const block=source.slice(source.indexOf('  function activeAccountView()'),source.indexOf("  window.addEventListener('focus',checkAccounts);"));
const storage=new Map([['adminToken','old-admin'],['studentToken','old-student']]);
const notices=[],calls=[];
const frame={contentDocument:{documentElement:{dataset:{page:'student-login'}}},contentWindow:{location:{href:'https://test/student-login.html'}}};
const ctx={URL,URLSearchParams,crypto:require("crypto").webcrypto,location:{origin:'https://test'},accountNotice:null,document:{hidden:false,getElementById:()=>frame},
 localStorage:{getItem:key=>storage.get(key)},window:{CreditAccountNotice:(kind,state)=>{notices.push([kind,state]);storage.delete(kind+'Token');}},
 fetch:async(url,opts)=>{calls.push(opts.headers.Authorization);return {json:async()=>({state:'online'})};}};
vm.createContext(ctx);vm.runInContext(block+';this.check=checkAccounts;',ctx);
function open(page){frame.contentDocument={documentElement:{dataset:{page}}};frame.contentWindow.location.href='https://test/'+page+'.html';}
(async()=>{
 await ctx.check();assert.equal(calls.length,0);
 open('index');storage.set('studentToken','new-student');await ctx.check();
 assert.deepEqual(calls,['Bearer new-student']);assert.equal(notices.length,0);
 let complete;ctx.fetch=()=>new Promise(resolve=>complete=resolve);
 const stale=ctx.check();storage.set('studentToken','newer-student');complete({json:async()=>({state:'revoked'})});await stale;
 assert.equal(notices.length,0);
 ctx.fetch=async()=>({status:401,json:async()=>({error:'unrelated'})});await ctx.check();assert.equal(notices.length,0);
 ctx.fetch=async()=>({json:async()=>({state:'revoked',kind:'student'})});await ctx.check();await ctx.check();
 assert.deepEqual(notices,[['student','revoked']]);
 console.log('PASS login view skipped, active role only, new session unaffected, stale heartbeat ignored, old session notified once');
})().catch(e=>{console.error(e);process.exitCode=1;});
