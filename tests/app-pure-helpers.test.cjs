const assert = require('node:assert/strict');
const { test } = require('node:test');

test('extracted auth runtime helpers preserve identity and redaction behavior', async () => {
  const { redactAuthSecrets, requireAuthoritativeIdentityState } = await import('../src/auth/authRuntime.js');
  assert.equal(redactAuthSecrets('Bearer secret-token'), 'Bearer [REDACTED]');
  assert.equal(redactAuthSecrets('access_token=abc'), 'access_token=[REDACTED]');
  assert.equal(requireAuthoritativeIdentityState({ user: { identityState: 'VERIFIED' } }), 'VERIFIED');
  assert.throws(() => requireAuthoritativeIdentityState({}), /IDENTITY_STATE_MISSING/);
});

test('extracted deferred bootstrap helpers preserve validated merge behavior', async () => {
  const { normalizeDeferredLikes, normalizeDeferredAnnouncements, mergeDeferredLikes } = await import('../src/features/bootstrap/deferredBootstrap.js');
  assert.deepEqual(normalizeDeferredLikes({
    '2026-10-03': { likeCount: 2.9, isUserLiked: true }
  }), {
    '2026-10-03': { likeCount: 2, isUserLiked: true, calendarEvent: null }
  });
  assert.equal(normalizeDeferredLikes([]), null);
  assert.deepEqual(normalizeDeferredAnnouncements([{
    id: 'a1', title: 'Notice', content: 'Text', start_date: '2026-10-01', end_date: '2026-10-03'
  }]), [{
    id: 'a1', title: 'Notice', content: 'Text', start_date: '2026-10-01', end_date: '2026-10-03'
  }]);
  assert.deepEqual(mergeDeferredLikes({
    '2026-10-03': { vendor: 'A', likeCount: 0 }
  }, {
    '2026-10-03': { likeCount: 5, isUserLiked: false, calendarEvent: null }
  })['2026-10-03'], { vendor: 'A', likeCount: 5, isUserLiked: false });
});

test('extracted order and ledger presentation helpers preserve output', async () => {
  const [{ parseMenuItemName }, { formatLedgerOrderDate }] = await Promise.all([
    import('../src/features/orders/menuItemName.js'),
    import('../src/features/balances/ledgerFormatters.js')
  ]);
  assert.deepEqual(parseMenuItemName('便當（半飯）'), { baseName: '便當', variant: '半飯' });
  assert.deepEqual(parseMenuItemName('便當'), { baseName: '便當', variant: '' });
  assert.equal(formatLedgerOrderDate('2026-10-03'), '10/3');
});
