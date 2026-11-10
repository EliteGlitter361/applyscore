import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(new URL('../assets/controllers/detail.mjs', import.meta.url).pathname).href;
const { mount } = await import(moduleUrl);

function setup({referrer, historyLength}) {
  let backCalls=0, fallback='';
  globalThis.localStorage={getItem:()=>null};
  globalThis.location={search:'?id=test',href:'https://portal.test/detail.html?id=test',origin:'https://portal.test',assign:(url)=>{fallback=url;}};
  globalThis.history={length:historyLength,back:()=>{backCalls++;}};
  globalThis.document={referrer,title:'',addEventListener(){},removeEventListener(){}};
  document.referrer=referrer;
  globalThis.window={
    CreditRouteGuard:{navigateAway:(url)=>{fallback=url;}},
    apiCache:{get:async()=>[]},
    syncBus:{on:()=>()=>{}},
    addEventListener(){},removeEventListener(){},
    flashError(){},flashSuccess(){},
  };
  globalThis.fetch=async()=>({ok:true,json:async()=>({id:'test',status:'approved',versionName:'测试活动'})});
  const vm={detailLoading:true,detailError:'',detailApp:null,detailCanEdit:false,detailForm:{},detailImageFailed:{},detailPreviewSrc:'',detailPreviews:[],detailEditing:false,detailCancelling:false};
  mount(vm);
  return {vm,get backCalls(){return backCalls;},get fallback(){return fallback;}};
}

const previous=setup({referrer:'https://portal.test/index.html',historyLength:2});
previous.vm.detailApi.goBack();
assert.equal(previous.backCalls,1,'same-origin history should be used');
assert.equal(previous.fallback,'','same-origin history should not redirect to index');

const direct=setup({referrer:'',historyLength:1});
direct.vm.detailApi.goBack();
assert.equal(direct.backCalls,0,'direct entry should not call history.back');
assert.equal(direct.fallback,'/index.html','direct entry should return to overview');

const foreign=setup({referrer:'https://external.test/',historyLength:5});
foreign.vm.detailApi.goBack();
assert.equal(foreign.backCalls,0,'cross-origin referrer should not be used');
assert.equal(foreign.fallback,'/index.html','cross-origin referrer should fall back to overview');

console.log('PASS detail return button: same-origin previous page, direct entry fallback, external referrer fallback');
