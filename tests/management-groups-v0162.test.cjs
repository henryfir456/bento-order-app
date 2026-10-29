const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = require('./helpers/app-source.cjs').readAppSource();

test('management hub groups existing actions without changing guards or handlers', () => {
  for(const group of ['訂餐管理','使用者與帳務','系統設定']) assert.match(app,new RegExp('aria-label="'+group+'"'));
  for(const label of ['店家專區 ›','訂單總覽 ›','使用者管理 ›','開團管理 ›','公告管理 ›','菜單品項維護 ›']) assert.ok(app.includes(label),label);
  assert.match(app,/canAuth\('viewMemberBalances'\).*?使用者管理 ›/);
  assert.match(app,/authRole !== 'Admin' && canAuth\('delegateOrder'\)/);
  assert.match(app,/authRole !== 'Admin' && canAuth\('viewAsUser'\)/);
  assert.doesNotMatch(app,/使用者管理中心 ›/);
});
test('calendar style keeps classic/modern state and concise labels', () => {
  assert.match(app,/aria-label="月曆樣式"/);
  assert.match(app,/>月曆樣式<\/h3>/);
  assert.match(app,/selectCalendarUi\('classic'\)[\s\S]*?>經典<\/button>/);
  assert.match(app,/selectCalendarUi\('modern'\)[\s\S]*?>極簡<\/button>/);
  assert.doesNotMatch(app,/aria-label="介面切換"/);
});
