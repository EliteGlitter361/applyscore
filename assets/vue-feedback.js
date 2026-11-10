/** Vue 3-owned toast and processing overlay. Preserves existing global service APIs. */
(() => {
  'use strict';
  if(!window.Vue)return;
  const holder=document.createElement('div');holder.id='credit-vue-feedback-host';document.body.appendChild(holder);
  const feedback=window.Vue.createApp({
    data:()=>({messages:[],busyCount:0,busyText:'正在处理…',nextId:1}),
    methods:{
      show(kind,text){
        if(kind==='success'&&Date.now()-(this._lastSuccess||0)<700)return;
        if(kind==='success')this._lastSuccess=Date.now();
        const id=this.nextId++;
        this.messages=[...this.messages.slice(-3),{id,kind,text:String(text||'操作已完成')}];
        setTimeout(()=>{this.messages=this.messages.filter(m=>m.id!==id)},kind==='error'?3000:2400);
      },
      start(text){this.busyText=String(text||'正在处理…');this.busyCount++;},
      stop(){this.busyCount=Math.max(0,this.busyCount-1);},
    },
    template:`<div class="credit-vue-feedback" aria-live="polite">
      <transition-group name="credit-toast" tag="div" class="credit-vue-toasts">
        <div v-for="entry in messages" :key="entry.id" class="credit-vue-toast" :class="entry.kind" role="status">
          <span aria-hidden="true">{{entry.kind==='error'?'!':'✓'}}</span><span>{{entry.text}}</span>
        </div>
      </transition-group>
      <transition name="credit-operation"><div v-if="busyCount>0" class="credit-vue-busy-overlay" role="dialog" aria-modal="true" aria-label="正在执行操作" aria-live="polite">
        <div class="credit-vue-busy-card"><img src="/assets/icons/网页选项卡标题，网站logo.webp" alt=""/><p>{{busyText}}</p></div>
      </div></transition>
    </div>`
  }).mount(holder);
  window.flashSuccess=message=>feedback.show('success',message);
  window.flashError=message=>feedback.show('error',message);
  window.showLoadingOverlay=message=>feedback.start(message);
  window.hideLoadingOverlay=()=>feedback.stop();
  window.withOverlay=async (message, task, minDuration=0)=>{
    const started=Date.now();feedback.start(message);
    try{
      const result=await task();
      const extra=minDuration-(Date.now()-started);
      if(extra>0)await new Promise(resolve=>setTimeout(resolve,extra));
      return result;
    }finally{feedback.stop();}
  };
  // Explicit business actions opt in. Never replace the browser's fetch:
  // authentication, read receipts, polling and detail navigation stay local.
  window.operationFetch=async function(label,input,options){
    feedback.start('正在'+label+'，请稍候…');
    try{const response=await window.fetch(input,options);let body={};try{body=await response.clone().json()}catch(_){}
      if(response.ok&&!body.error)feedback.show('success',body.message&&body.message!=='ok'?body.message:label+'成功');
      else feedback.show('error',body.error||label+'失败，请重试');
      return response;
    }catch(error){feedback.show('error',label+'结果尚未确认，请刷新核对后再重试');throw error;}finally{feedback.stop();}
  };
})();
