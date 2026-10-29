const fs = require('node:fs');
const path = require('node:path');

// App.jsx plus the components extracted from it, for tests that assert on rendered source.
const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', ...parts), 'utf8');

exports.readAppSource = () => [
  read('App.jsx'),
  read('features', 'admin', 'AdminHub.jsx'),
  read('features', 'balances', 'BalanceHistoryModal.jsx'),
  read('features', 'calendar', 'calendarDays.jsx')
].join('\n');
