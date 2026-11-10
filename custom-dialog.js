/** Vue 3 shared dialogs – retained showAlert/showConfirm/showPrompt APIs for existing business controllers. */
(() => {
  'use strict';
  let ui, pending = [];
  const EMPTY = Object.freeze({visible:false,type:'alert',title:'',message:'',value:'',placeholder:'',confirmText:'确定',cancelText:'取消',textAlign:'center',banMode:'duration',banHours:'',banDate:'',banError:''});
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
          this.$nextTick(()=>{(['prompt','ban'].includes(this.dialog.type)?this.$refs.input:this.$refs.accept)?.focus?.();});
        },
        finish(accepted) {
          if(!this.dialog.visible)return;
          let ban = null;
          if (accepted && this.dialog.type === 'ban') {
            const banReason = this.dialog.value.trim();
            const now = Date.now();
            const hours = Number(this.dialog.banHours);
            const banUntil = this.dialog.banMode === 'date'
              ? new Date(this.dialog.banDate).getTime() : now + hours * 3600000;
            if (!banReason || banReason.length > 300) {
              this.dialog.banError = '请填写 1 至 300 字的封禁原因';
              return;
            }
            if ((this.dialog.banMode === 'duration' && !Number.isInteger(hours)) ||
                !Number.isSafeInteger(banUntil) || banUntil <= now || banUntil > now + 365 * 86400000) {
              this.dialog.banError = '请选择未来 365 天内的日期时间，或填写 1 至 8760 小时';
              return;
            }
            ban = {banReason, banUntil};
          }
          const value=this.dialog.type==='ban' ? ban : this.dialog.type==='prompt' ? (accepted ? this.dialog.value : null) : !!accepted;
          const callback=this.callback;this.callback=null;
          this.dialog={...EMPTY};
          callback?.(value);
        },
        escape(e) {if(e.key==='Escape'){e.preventDefault();this.finish(false);}},
        backdrop(e){if(e.target===e.currentTarget && this.dialog.type==='alert')this.finish(true);},
        keepFocus(e){if(e.key!=='Tab')return;
          const btns=[...e.currentTarget.querySelectorAll('input, select, button')].filter(x=>!x.disabled);
          if(!btns.length)return;
          if(e.shiftKey&&document.activeElement===btns[0]){e.preventDefault();btns.at(-1).focus();}
          else if(!e.shiftKey&&document.activeElement===btns.at(-1)){e.preventDefault();btns[0].focus();}}
      },
      template:`<transition name="credit-dialog"><div v-if="dialog.visible" class="credit-dialog-mask" role="presentation" @click="backdrop" @keydown="escape" @keydown.tab="keepFocus">
        <section class="credit-dialog-card" role="dialog" aria-modal="true" :aria-label="dialog.title||'系统提示'">
          <h3 v-if="dialog.title">{{dialog.title}}</h3>
          <p :style="{textAlign:dialog.textAlign}">{{dialog.message}}</p>
          <input v-if="dialog.type==='prompt'" ref="input" v-model="dialog.value" :placeholder="dialog.placeholder" type="text" @keydown.enter.prevent="finish(true)" />
          <div v-if="dialog.type==='ban'" class="credit-ban-fields">
            <label>封禁原因<input ref="input" v-model="dialog.value" maxlength="300" type="text"></label>
            <label>时间设置<select v-model="dialog.banMode">
              <option value="duration">按时长</option><option value="date">按日期时间</option>
            </select></label>
            <label v-if="dialog.banMode==='duration'">封禁时长（小时）<input v-model="dialog.banHours" type="number" min="1" max="8760" step="1"></label>
            <label v-else>解封日期和时间（本机时间）<input v-model="dialog.banDate" type="datetime-local"></label>
            <p v-if="dialog.banError" role="alert">{{dialog.banError}}</p>
          </div>
          <div class="credit-dialog-actions">
            <button v-if="dialog.type!=='alert'" ref="cancel" type="button" class="credit-dialog-cancel" @click="finish(false)">{{dialog.cancelText}}</button>
            <button ref="accept" type="button" class="credit-dialog-accept" @click="finish(true)">{{dialog.confirmText}}</button>
          </div>
        </section>
      </div></transition>`
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
  window.CreditPromptBan = name => new Promise(resolve => open({
    type:'ban', title:'账户封禁', message:'请填写 '+name+' 的封禁原因和时间。', confirmText:'确认封禁'
  }, resolve));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensureUI,{once:true});else ensureUI();
})();
