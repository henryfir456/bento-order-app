import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleFormalRequest } from '../src/formalWorker.js';
import { SqliteD1 } from './helpers/formal-db.js';
import { profileFetch, request, seedUser } from './helpers/formal-fixtures.js';

test('calendar announcements use inclusive Taipei date windows and deterministic order', async () => {
  const database = new SqliteD1();
  seedUser(database, { lineUserId: 'user-1' });
  database.run(`
    INSERT INTO announcements (
      announcement_id, title, content, start_date, end_date, enabled, source_order
    ) VALUES
      ('announcement-low', 'Low', 'Low', '2026-09-01', '2026-09-08', 1, 1),
      ('announcement-high', 'High', 'High', '2026-09-01', '2026-09-08', 1, 2),
      ('announcement-future', 'Future', 'Future', '2026-09-09', '2026-09-10', 1, 3),
      ('announcement-disabled', 'Disabled', 'Disabled', '2026-09-01', '2026-09-08', 0, 4)
  `);
  const response = await handleFormalRequest(
    request('/api/calendar', { token: 'user-token' }),
    { DB: database },
    {
      fetchImpl: profileFetch({ token: 'user-token', lineUserId: 'user-1' }),
      now: new Date('2026-09-08T00:00:00.000Z')
    }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.announcements.map((item) => item.id), [
    'announcement-high',
    'announcement-low'
  ]);
});
