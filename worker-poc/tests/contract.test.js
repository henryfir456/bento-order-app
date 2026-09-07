import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const fixtureUrl = new URL('../contracts/bootstrap-contract.json', import.meta.url);
const fixture = JSON.parse(fs.readFileSync(fixtureUrl, 'utf8'));

test('canonical fixture separates the four externally observable surfaces', () => {
  assert.deepEqual(Object.keys(fixture.surfaces).sort(), [
    'deferredBootstrap',
    'invalidActionFallback',
    'orderPage',
    'primaryBootstrap'
  ]);
});

test('primary contract excludes deferred and order-page data', () => {
  const primary = fixture.surfaces.primaryBootstrap;

  assert.deepEqual(primary.requiredTopLevelKeys, [
    'success',
    'registered',
    'user',
    'calendar',
    'ordersMap',
    'targetDate'
  ]);
  assert.deepEqual(primary.emptyCollections['calendar.announcements'], []);
  assert.equal(primary.emptyCollections['calendar.announcement'], null);
  assert.ok(primary.deferredFields.includes('likes'));
  assert.ok(primary.orderPageFields.includes('menu'));
});

test('deferred, fallback, and order-page contracts describe their request boundaries', () => {
  const { deferredBootstrap, invalidActionFallback, orderPage } = fixture.surfaces;

  assert.equal(deferredBootstrap.worker.path, '/api/bootstrap/deferred');
  assert.deepEqual(invalidActionFallback.requestsInOrder, [
    'POST getUserInfo',
    'GET getUserAllOrdersMap',
    'GET getCalendarEvents'
  ]);
  assert.equal(orderPage.worker.path, '/api/order-page');
});

test('intentional differences explain auth, transport, observability, and side contracts', () => {
  const ids = fixture.intentionalDifferences.map((difference) => difference.id);

  for (const id of [
    'worker-auth-input',
    'worker-display-name-source',
    'worker-http-errors',
    'runtime-observability',
    'invalid-action-fallback',
    'bootstrap-side-contracts',
    'diagnostic-endpoints'
  ]) {
    assert.ok(ids.includes(id), `missing intentional difference: ${id}`);
  }
});
