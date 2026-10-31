/** Vue 3 shared dialogs – retained showAlert/showConfirm/showPrompt APIs for existing business controllers. */
(() => {
  'use strict';
  let ui, pending = [];
  const EMPTY = Object.freeze({visible:false,type:'alert',title:'',message:'',value:'',placeholder:'',confirmText:'确定',cancelText:'取消',textAlign:'center'});
  function ensureUI() {
    if (ui) return ui;
    if (!window.Vue || !document.body) return null;
    const mountPoint = document.createElement('div');
    mountPoint.id = 'credit-vue-dialog-host';
    document.body.appendChild(mountPoint);
    ui = window.Vue.createApp({
      data:()=>({dialog:{...EMPTY},callback:null}),
      methods:{
        open(options,callback) {
          // If another dialog is visible, safely cancel it before replacing.
          if(this.dialog.visible) this.finish(false);
          this.callback=callback;
          this.dialog={...EMPTY,...options,visible:true,value:String(options.value??'')};
          this.$nextTick(()=>{(this.dialog.type==='prompt'?this.$refs.input:this.$refs.accept)?.focus?.();});
        },
        finish(accepted) {
          if(!this.dialog.visible)return;
          const value=this.dialog.type==='prompt' ? (accepted ? this.dialog.value : null) : !!accepted;
          const callback=this.callback;this.callback=null;
          this.dialog={...EMPTY};
          callback?.(value);
        },
        escape(e) {if(e.key==='Escape'){e.preventDefault();this.finish(false);}},
        backdrop(e){if(e.target===e.currentTarget && this.dialog.type==='alert')this.finish(true);},
        keepFocus(e){if(e.key!=='Tab')return;
          const btns=[this.$refs.input,this.$refs.cancel,this.$refs.accept].filter(x=>x&&!x.disabled);
          if(!btns.length)return;
          if(e.shiftKey&&document.activeElement===btns[0]){e.preventDefault();btns.at(-1).focus();}
          else if(!e.shiftKey&&document.activeElement===btns.at(-1)){e.preventDefault();btns[0].focus();}}
      },
      template:`<div v-if="dialog.visible" class="credit-dialog-mask" role="presentation" @click="backdrop" @keydown="escape" @keydown.tab="keepFocus">
        <section class="credit-dialog-card" role="dialog" aria-modal="true" :aria-label="dialog.title||'系统提示'">
          <h3 v-if="dialog.title">{{dialog.title}}</h3>
          <p :style="{textAlign:dialog.textAlign}">{{dialog.message}}</p>
          <input v-if="dialog.type==='prompt'" ref="input" v-model="dialog.value" :placeholder="dialog.placeholder" type="text" @keydown.enter.prevent="finish(true)" />
          <div class="credit-dialog-actions">
            <button v-if="dialog.type!=='alert'" ref="cancel" type="button" class="credit-dialog-cancel" @click="finish(false)">{{dialog.cancelText}}</button>
            <button ref="accept" type="button" class="credit-dialog-accept" @click="finish(true)">{{dialog.confirmText}}</button>
          </div>
        </section>
      </div>`
    }).mount(mountPoint);
    for(const job of pending)ui.open(...job);
    pending=[];
    return ui;
  }
  function open(options,callback) {
    const el=ensureUI();
    if(el)el.open(options,callback);else pending.push([options,callback]);
    return ()=>{if(ui)ui.finish(false);};
  }
  window.showAlert=(title,message,confirmText='确定',callback=null,options={})=>open({type:'alert',title,message,confirmText,textAlign:options.textAlign||'center'},()=>callback?.());
  window.showConfirm=(title,message,confirmText='确定',cancelText='取消',callback=null,options={})=>open({type:'confirm',title,message,confirmText,cancelText,textAlign:options.textAlign||'center'},callback);
  window.showPrompt=(title,message,defaultValue='',placeholder='',confirmText='确定',cancelText='取消',callback=null,options={})=>open({type:'prompt',title,message,confirmText,cancelText,value:defaultValue,placeholder,textAlign:options.textAlign||'center'},callback);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensureUI,{once:true});else ensureUI();
})();
