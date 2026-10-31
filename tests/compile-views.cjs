/** 13-page Vue compiler smoke test (no npm dependencies). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname,'..');
const sandbox = { console, setTimeout, clearTimeout, performance: {now: Date.now},
  document: { createElement: tag=>({tagName:tag,style:{},innerHTML:'',content:{}}),createElementNS:(ns,tag)=>({tagName:tag}) }, navigator:{} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root,'vendor/vue.global.js'),'utf8'),sandbox);
const pages=['index','upload','detail','file-upload','messages','student-login','login','create-system','close','about','dashboard','student','admin','music','settings'];
let failures=0;
for(const page of pages) {
  const html=fs.readFileSync(path.join(root,page+'.html'),'utf8');
  const match=html.match(/<template id="page-template">([\s\S]*?)<\/template>/);
  if(!match){console.error('Missing view:',page);failures++;continue;}
  try { sandbox.Vue.compile(match[1]); console.log('PASS',page); }
  catch(e){ console.error('FAIL',page,e.message); failures++; }
  for(const file of [...(['student-login','login','create-system','close','about','music','settings'].includes(page) ? [] : [`assets/controllers/${page}.mjs`]),`assets/pages/${page}.css`]){
    if(!fs.existsSync(path.join(root,file))){console.error('Missing',file);failures++;}
  }
}
const appSource = fs.readFileSync(path.join(root,'assets/app.js'),'utf8');
const shellMatch = appSource.match(/    template: `([\s\S]+?)`\n  \}\);/);
if (!shellMatch) {console.error('Missing Vue application shell template');failures++;}
else try {sandbox.Vue.compile(shellMatch[1]);console.log('PASS Vue application shell');}
catch(e) {console.error('FAIL Vue application shell',e.message);failures++;}
console.log(`Vue ${sandbox.Vue.version} | ${pages.length} views + shell checked`);
process.exitCode=failures?1:0;
