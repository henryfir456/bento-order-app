import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deadlineAt, deadlineInfo } from '../src/domain/deadlines.js';

test('mode A is open at the exact 10:00 Asia/Taipei deadline and closes after it', () => {
  const deadline = deadlineAt('2026-09-08', 'A');
  assert.equal(deadline.toISOString(), '2026-09-08T02:00:00.000Z');
  assert.equal(deadlineInfo('2026-09-08', 'A', deadline).isExpired, false);
  assert.equal(
    deadlineInfo('2026-09-08', 'A', new Date('2026-09-08T02:00:00.001Z')).isExpired,
    true
  );
});

test('mode B is open at the previous-day 18:00 deadline and closes after it', () => {
  const deadline = deadlineAt('2026-09-08', 'B');
  assert.equal(deadline.toISOString(), '2026-09-07T10:00:00.000Z');
  assert.equal(deadlineInfo('2026-09-08', 'B', deadline).isExpired, false);
  assert.equal(
    deadlineInfo('2026-09-08', 'B', new Date('2026-09-07T10:00:00.001Z')).isExpired,
    true
  );
});
