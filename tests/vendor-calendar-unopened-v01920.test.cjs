const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('vendor calendar highlights unopened days in red with a legend', () => {
  const source = fs.readFileSync('src/features/vendors/VendorCalendar.jsx', 'utf8');
  assert.match(source, /border-red-400 bg-red-50 text-red-700/);
  assert.match(source, /未開團（可能成為禾拾團）/);
  assert.match(source, /border-emerald-300 bg-emerald-50/);
});
