// Offline regression of the actual Pages file proxy and Gitee helper.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const fixtureBytes = Buffer.from('%PDF-测试文件-\u0000-OK', 'utf8');
let fileCalls = [];
let mode = 'ok';
function getRawFileContentFromGitee(_env, filePath) {
  fileCalls.push(filePath);
  if (mode === 'notfound') throw new Error('获取文件失败 (404)');
  if (mode === 'ratelimited') throw new Error('获取文件失败 (429)');
  if (mode === 'upstream') throw new Error('获取文件失败 (502)');
  return Promise.resolve(fixtureBytes.toString('base64').replace(/(.{45})/g, '$1\n'));
}
const proxySource = fs.readFileSync(path.join(root, 'functions/api/uploads/[id]/[fileName].js'), 'utf8')
  .replace(/^import .*?;\s*$/m, '')
  .replace('export async function onRequest', 'async function onRequest');
const onRequest = new Function('getRawFileContentFromGitee', proxySource + '\nreturn onRequest;')(getRawFileContentFromGitee);
const url = (id, file) => 'https://example.test/api/uploads/' + encodeURIComponent(id) + '/' + encodeURIComponent(file);
const expectError = async (link, code) => {
  const res = await onRequest({request: new Request(link), env: {}});
  assert.equal(res.status, code, link);
  return res.json();
};
(async () => {
  for (const fileName of ['1_成绩证明.pdf', '2_my notes 25%.pdf', '3_photo.jpg', '4_百分比#?.zip']) {
    mode = 'ok';
    const res = await onRequest({request: new Request(url('1234_01001', fileName)), env: {}});
    assert.equal(res.status, 200, fileName);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), fixtureBytes);
    assert.equal(fileCalls.at(-1), 'data/uploads/1234_01001/' + fileName);
  }
  assert.equal((await expectError(url('123', '../private'), 400)).retryable, false);
  assert.equal((await expectError('https://example.test/api/uploads/123/%E0%A4%A', 400)).retryable, false);
  mode = 'notfound'; assert.equal((await expectError(url('123', '1_不存在.pdf'), 404)).retryable, false);
  mode = 'ratelimited'; assert.equal((await expectError(url('123', '1_任意.pdf'), 503)).retryable, true);
  mode = 'upstream'; assert.equal((await expectError(url('123', '1_任意.pdf'), 502)).retryable, true);
  // Check Gitee URL is built from properly encoded path components.
  const helperSource = fs.readFileSync(path.join(root, 'functions/utils/gitee.js'), 'utf8')
    .replace(/export (async function|function) /g, '$1 ');
  const helper = new Function('fetch', helperSource + '\nreturn getRawFileContentFromGitee;')(
    async (giteeUrl) => {
      assert.ok(giteeUrl.includes('/data/uploads/1234_01001/1_%E6%88%90%E7%BB%A9%E8%AF%81%E6%98%8E.pdf'));
      return {ok:true,json:async()=>({content: fixtureBytes.toString('base64')})};
    }
  );
  const result = await helper({GITEE_TOKEN:'testing',GITEE_OWNER:'owner',GITEE_REPO:'repo'},
    'data/uploads/1234_01001/1_成绩证明.pdf');
  assert.equal(result, fixtureBytes.toString('base64'));
  console.log('PASS: filename decoding, safe paths, upstream status, binary bytes and Gitee URL encoding');
})().catch(e => { console.error(e); process.exitCode = 1; });
