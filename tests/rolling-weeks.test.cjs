const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const load = () => import(pathToFileURL(path.join(__dirname, '../src/features/calendar/rollingWeeks.js')).href);

test('midweek date yields last, this and next Monday-Friday rows', async () => {
  const { buildRollingWeeks } = await load();
  const weeks = buildRollingWeeks('2026-10-28');
  assert.deepEqual(weeks.map((week) => week.label), ['上週', '本週', '下週']);
  assert.deepEqual(weeks.map((week) => week.days[0].key), ['2026-10-19', '2026-10-26', '2026-11-02']);
  assert.equal(weeks[1].days[4].key, '2026-10-30');
  assert.equal(weeks[2].days[0].month, 11);
});

test('weekend rolls this week forward to the coming Monday', async () => {
  const { buildRollingWeeks } = await load();
  assert.equal(buildRollingWeeks('2026-10-31')[1].days[0].key, '2026-11-02');
  assert.equal(buildRollingWeeks('2026-11-01')[1].days[0].key, '2026-11-02');
});
