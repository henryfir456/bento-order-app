import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertOpeningBalancePolicy,
  isApprovedOpeningBalancePolicy
} from '../src/domain/ledger.js';

test('opening balance promotion fails closed without reviewed policy metadata', () => {
  assert.equal(isApprovedOpeningBalancePolicy(undefined), false);
  assert.equal(isApprovedOpeningBalancePolicy({ approved: true }), false);
  assert.throws(
    () => assertOpeningBalancePolicy({ approved: true }),
    (error) => error.code === 'OPENING_BALANCE_POLICY_REQUIRED'
  );
});

test('opening balance promotion requires explicit reviewer, policy, date, and reference', () => {
  const policy = {
    approved: true,
    policyId: 'opening-balance-v1',
    approvedBy: 'admin-1',
    approvedAt: '2026-09-08T00:00:00.000Z',
    reference: 'POLICY-REVIEW-001'
  };
  assert.equal(isApprovedOpeningBalancePolicy(policy), true);
  assert.deepEqual(assertOpeningBalancePolicy(policy), policy);
});
