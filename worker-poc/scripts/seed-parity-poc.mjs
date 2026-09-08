import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPocRemoteOperationBlocked } from './poc-target-guard.mjs';

assertPocRemoteOperationBlocked();

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workerDirectory = path.resolve(scriptDirectory, '..');

const requiredEnv = (name) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const quoteSql = (value) => `'${String(value).replaceAll("'", "''")}'`;

const userId = requiredEnv('POC_USER_ID');
if (!/^[A-Za-z0-9_-]+$/.test(userId)) {
  throw new Error('POC_USER_ID must contain only ASCII letters, numbers, underscore, or hyphen.');
}

const calendarRows = [
  ['2026-09-01', 'Synthetic Vendor 01', 'A'],
  ['2026-09-02', 'Synthetic Vendor 02', 'A'],
  ['2026-09-03', 'Synthetic Vendor 03', 'B'],
  ['2026-09-04', 'Synthetic Vendor 04', 'A'],
  ['2026-09-05', 'Synthetic Vendor 05', 'B'],
  ['2026-09-07', 'Synthetic Vendor 07', 'A'],
  ['2026-09-08', 'POC Vendor', 'A'],
  ['2026-09-09', 'Synthetic Vendor 09', 'A'],
  ['2026-09-10', 'Synthetic Vendor 10', 'B'],
  ['2026-09-11', 'Synthetic Vendor 11', 'A'],
  ['2026-09-14', 'Synthetic Vendor 14', 'A'],
  ['2026-09-15', 'Synthetic Vendor 15', 'B'],
  ['2026-09-25', 'Synthetic Vendor 25', 'A']
];

const orderRows = [
  {
    orderId: 'POC-ORDER-002',
    orderDate: '2026-09-03',
    vendor: 'Synthetic Vendor 03',
    itemId: 'POC-ITEM-002',
    itemName: 'Synthetic Item 02',
    unitPrice: 80,
    createdAt: '2026-09-07 10:03:00'
  },
  {
    orderId: 'POC-ORDER-003',
    orderDate: '2026-09-04',
    vendor: 'Synthetic Vendor 04',
    itemId: 'POC-ITEM-003',
    itemName: 'Synthetic Item 03',
    unitPrice: 85,
    createdAt: '2026-09-07 10:04:00'
  }
];

const statements = calendarRows.map(([orderDate, vendor, mode]) => (
  `INSERT INTO calendar_settings (order_date, vendor, mode) VALUES (${quoteSql(orderDate)}, ${quoteSql(vendor)}, ${quoteSql(mode)}) `
  + 'ON CONFLICT(order_date) DO UPDATE SET vendor = excluded.vendor, mode = excluded.mode'
));

statements.push(
  `INSERT OR IGNORE INTO likes (order_date, line_user_id, created_at) VALUES (${quoteSql('2026-09-08')}, ${quoteSql(userId)}, ${quoteSql('2026-09-07 10:01:00')})`
);

statements.push(
  `INSERT OR IGNORE INTO order_status (order_row_id, status, updated_at) `
  + `SELECT id, 'ACTIVE', ${quoteSql('2026-09-07 10:02:00')} FROM orders WHERE order_id = 'POC-ORDER-001' AND line_user_id = ${quoteSql(userId)}`
);

for (const row of orderRows) {
  statements.push(
    `INSERT INTO orders (order_id, order_date, vendor, line_user_id, item_id, item_name, quantity, unit_price, subtotal, pickup_floor, note, created_at) `
    + `SELECT ${quoteSql(row.orderId)}, ${quoteSql(row.orderDate)}, ${quoteSql(row.vendor)}, ${quoteSql(userId)}, ${quoteSql(row.itemId)}, ${quoteSql(row.itemName)}, 1, ${row.unitPrice}, ${row.unitPrice}, 'SYNTH-1F', 'synthetic parity seed', ${quoteSql(row.createdAt)} `
    + `WHERE NOT EXISTS (SELECT 1 FROM orders WHERE order_id = ${quoteSql(row.orderId)})`
  );
  statements.push(
    `INSERT OR IGNORE INTO order_status (order_row_id, status, updated_at) `
    + `SELECT id, 'ACTIVE', ${quoteSql('2026-09-07 10:05:00')} FROM orders WHERE order_id = ${quoteSql(row.orderId)} AND line_user_id = ${quoteSql(userId)}`
  );
}

const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const commandArgs = [
  'exec', '--', 'wrangler', 'd1', 'execute', 'bento-poc-legacy-local', '--remote',
  '--command', `${statements.join(';')};`, '--json', '--config', 'wrangler-poc.jsonc'
];
const isWindowsCommand = process.platform === 'win32';
const executable = isWindowsCommand ? (process.env.ComSpec || 'cmd.exe') : command;
const args = isWindowsCommand ? ['/d', '/s', '/c', command, ...commandArgs] : commandArgs;
const result = spawnSync(executable, args, {
  cwd: workerDirectory,
  encoding: 'utf8',
  shell: false
});

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`Remote synthetic seed exited with status ${result.status}.`);
}

process.stdout.write(JSON.stringify({
  seed: 'parity-poc',
  calendarEntries: calendarRows.length,
  orderDatesAdded: orderRows.length,
  likeDate: '2026-09-08',
  orderStatus: 'ACTIVE'
}, null, 2) + '\n');
