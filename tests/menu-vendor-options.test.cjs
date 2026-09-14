const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const repositoryRoot = path.join(__dirname, '..');

test('calendar vendor options expose 禾拾 but not legacy 合十', () => {
  const source = fs.readFileSync(
    path.join(repositoryRoot, 'src', 'features', 'calendar', 'CalendarManagement.jsx'),
    'utf8'
  );
  assert.match(source, /<option value="禾拾">禾拾<\/option>/);
  assert.doesNotMatch(source, /<option value="合十">合十<\/option>/);
});
