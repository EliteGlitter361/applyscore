const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const pages = {
  'index.html':'index','messages.html':'messages','student.html':'student',
  'file-upload.html':'file-upload','detail.html':'detail','admin.html':'admin',
  'dashboard.html':'dashboard','upload.html':'upload'
};
for (const [file, controller] of Object.entries(pages)) {
  const html = fs.readFileSync(path.join(root,file),'utf8');
  const url = `/assets/controllers/${controller}.mjs?v=${controller==='index'?'3.8.0':controller==='detail'?'3.7.3':'3.7.2'}`;
  if (!html.includes(`<link rel="modulepreload" href="${url}">`)) throw Error(`${file}: missing ${url}`);
  if (!fs.existsSync(path.join(root,`assets/controllers/${controller}.mjs`))) throw Error(`${file}: missing controller`);
}
for (const file of Object.keys(pages)) {
  const html = fs.readFileSync(path.join(root,file),'utf8');
  const count = (html.match(/rel="modulepreload"/g)||[]).length;
  if (count !== 1) throw Error(`${file}: expected exactly one controller preload, got ${count}`);
}
const app=fs.readFileSync(path.join(root,'assets/app.js'),'utf8');
if (!app.includes("page === 'index' ? '3.8.0'")) throw Error('index controller cache version is stale');
const music=fs.readFileSync(path.join(root,'assets/music-shell.js'),'utf8');
if (!music.includes('this._trackRefreshHandle = idle(() =>')) throw Error('music catalogue refresh is not deferred');
if (!music.includes('this.refreshTracks();')) throw Error('manual/idle music refresh missing');
const headers=fs.readFileSync(path.join(root,'_headers'),'utf8');
if (!headers.includes('Cache-Control: no-store')) throw Error('no-store policy is missing');
console.log('PASS: all page controllers are preloaded once, import URL matches, music catalogue refresh is idle-scheduled, static cache policy exists');
