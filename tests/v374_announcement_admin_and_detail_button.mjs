import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const detail=readFileSync(new URL('../detail.html',import.meta.url),'utf8');
const detailCss=readFileSync(new URL('../assets/pages/detail.css',import.meta.url),'utf8');
const coreCss=readFileSync(new URL('../assets/core.css',import.meta.url),'utf8');

const adminButton='<a class="btn btn-primary index-admin-login" href="/login.html">管理员登录</a>';
assert.equal(index.split('index-admin-login').length-1,1,'homepage should contain one administrator login entry');
const announcementStart=index.indexOf('class="index-announcement-page');
const announcementEnd=index.indexOf('</section>',announcementStart);
const adminIndex=index.indexOf(adminButton);
assert.ok(announcementStart>=0 && adminIndex>announcementStart && adminIndex<announcementEnd,
  'administrator login entry must be inside the full-screen announcement');
const headerStart=index.indexOf('<div class="page-header">');
const headerEnd=index.indexOf('</div>',headerStart);
assert.ok(!(adminIndex>=headerStart && adminIndex<headerEnd),
  'administrator login entry must not be in the normal page header');
assert.match(index,/announcement-actions"><button v-if="indexAnnouncementShowConfirm"/,
  'announcement confirm button remains optional beside admin login');

assert.match(detail,/class="btn detail-back-button"/,
  'detail return button must use Vue 3 shared button classes');
assert.doesNotMatch(detail,/class="btn-back"/,
  'detail return button must not use legacy back-button class');
assert.match(coreCss,/\.page-view \.btn-outline/,
  'shared Vue 3 outline button styling exists');
assert.match(detailCss,/detail-back-button/,
  'detail return button layout styling exists');

console.log('PASS admin login only inside announcement; detail return uses Vue 3 button style');
