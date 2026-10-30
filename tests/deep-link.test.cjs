const assert = require('node:assert/strict');
const { test } = require('node:test');

test('deep link target is read from ?go= or liff.state and limited to known pages', async () => {
  const { parseDeepLinkTarget } = await import('../src/features/navigation/deepLink.js');
  assert.equal(parseDeepLinkTarget('?go=wallet'), 'wallet');
  assert.equal(parseDeepLinkTarget('?liff.state=%3Fgo%3DmyOrders'), 'myOrders');
  assert.equal(parseDeepLinkTarget('?liff.state=%2Fx%3Fgo%3Dvendor'), 'vendor');
  assert.equal(parseDeepLinkTarget('?go=admin'), '');
  assert.equal(parseDeepLinkTarget('?go=__proto__'), '');
  assert.equal(parseDeepLinkTarget(''), '');
  assert.equal(parseDeepLinkTarget(undefined), '');
});
