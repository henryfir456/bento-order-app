const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const repositoryRoot = path.join(__dirname, '..');

test('calendar vendor options are supplied from canonical runtime data', () => {
  const source = fs.readFileSync(
    path.join(repositoryRoot, 'src', 'features', 'calendar', 'CalendarManagement.jsx'),
    'utf8'
  );
  assert.match(source, /vendorOptions\.map/);
  assert.match(source, /<option key=\{vendor\} value=\{vendor\}>\{vendor\}<\/option>/);
  assert.doesNotMatch(source, /<option value="合十">合十<\/option>/);
});
