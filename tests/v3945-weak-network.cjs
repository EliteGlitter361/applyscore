const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(__dirname+'/../api-cache.js','utf8');
let now=100000,calls=0,timer,poll,mode='ok';
const ctx={Headers,Date:class extends Date{static now(){return now;}},CustomEvent:class{},localStorage:{getItem:()=>''},
 sessionStorage:{getItem:()=>null,setItem(){}},document:{hidden:false,addEventListener(){}},
 window:{AbortController,navigator:{onLine:true}},setTimeout:fn=>(timer=fn,1),clearTimeout(){},setInterval:fn=>(poll=fn,1),
 fetch:async(url,{signal})=>{calls++;if(mode==='fail')throw Error('network');if(mode==='stall')return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('abort'))));return Response.json({value:calls});}};
vm.createContext(ctx);vm.runInContext(source,ctx);
(async()=>{
 const cache=ctx.window.apiCache;
 assert.equal((await cache.get('/api/apps',{ttl:5000})).value,1);
 now+=5001;mode='fail';assert.equal((await cache.get('/api/apps',{ttl:5000})).value,1);
 await new Promise(setImmediate);poll();assert.equal(calls,2);
 now+=5001;mode='ok';poll();await new Promise(setImmediate);assert.equal((await cache.get('/api/apps',{ttl:5000})).value,3);
 mode='stall';const pending=cache.get('/api/settings',{ttl:0});timer();await assert.rejects(pending,/网络响应超时/);
 console.log('PASS stale content, retry backoff, successful background recovery and aborted hanging fresh request');
})().catch(e=>{console.error(e);process.exitCode=1;});
