/** Vue 3-owned toast and processing overlay. Preserves existing global service APIs. */
(() => {
  'use strict';
  if(!window.Vue)return;
  const holder=document.createElement('div');holder.id='credit-vue-feedback-host';document.body.appendChild(holder);
  const feedback=window.Vue.createApp({
    data:()=>({messages:[],busyCount:0,busyText:'正在处理…',nextId:1}),
    methods:{
      show(kind,text){
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
      <div v-if="busyCount>0" class="credit-vue-busy-overlay" role="status" aria-live="polite">
        <div class="credit-vue-busy-card"><img src="/assets/icons/网页选项卡标题，网站logo.webp" alt=""/><p>{{busyText}}</p></div>
      </div>
    </div>`
  }).mount(holder);
  window.flashSuccess=message=>feedback.show('success',message);
  window.flashError=message=>feedback.show('error',message);
  window.showLoadingOverlay=message=>feedback.start(message);
  window.hideLoadingOverlay=()=>feedback.stop();
  window.withOverlay=async (message, task, minDuration=500)=>{
    const started=Date.now();feedback.start(message);
    try{
      const result=await task();
      const extra=minDuration-(Date.now()-started);
      if(extra>0)await new Promise(resolve=>setTimeout(resolve,extra));
      return result;
    }finally{feedback.stop();}
  };
})();
