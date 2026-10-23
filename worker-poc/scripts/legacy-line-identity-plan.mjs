// Read-only planner for migration 0023's order_line_canonical_identities.
// Reads the current order lines, applies the reviewed rules, and writes
//   - apply-identities.sql  INSERT statements (NOT executed by this script)
//   - needs-review.csv      lines the rules could not settle
//   - risky-orders.csv      every line of orders with mixed vendors or unsettled lines
//   - plan-summary.md       counts per rule/vendor and risky orders
//
//   node scripts/legacy-line-identity-plan.mjs --remote --reviewer <admin user_id> [--out <dir>]
//   node scripts/legacy-line-identity-plan.mjs --local-db <path> --reviewer <admin user_id>
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CATALOG_SQL, VENDORS_SQL, localQuery, remoteQuery } from './legacy-order-identity-report.mjs';
import { LINE_SQL, buildContext, planIdentities, toInsertSql } from './lib/legacy-line-identity.mjs';

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const summarize = ({ writes, reviews, mixedOrders, partialOrders }) => {
  const count = (rows, key) => rows.reduce((map, row) => map.set(key(row), (map.get(key(row)) || 0) + 1), new Map());
  const table = (map, header) => [`| ${header} | 筆數 |`, '| --- | ---: |',
    ...[...map.entries()].sort().map(([name, value]) => `| ${name} | ${value} |`)];
  return [
    '# 舊訂單品項補正計畫', '',
    `- 可寫入：${writes.length} 筆`, `- 需人工確認（不寫入）：${reviews.length} 筆`,
    `- 店家不一致的訂單：${mixedOrders.length} 張`,
    `- 部分行可寫、部分需確認的訂單：${partialOrders.length} 張（這些訂單補完前不會歸屬店家）`, '',
    '## 依規則', '', ...table(count(writes, (row) => row.basis), '依據'), '',
    '## 依店家', '', ...table(count(writes, (row) => row.vendorId || '（非餐點）'), 'vendor_id'), '',
    '## 需人工確認的原因', '', ...table(count(reviews, (row) => `${row.source.order_vendor} ${row.source.code} ${row.source.name} — ${row.reason}`), '原因'), ''
  ].join('\n');
};

const reviewCsv = (reviews) => `﻿${[
  '訂單,行,日期,店家,代碼,名稱,單價,原因',
  ...reviews.map(({ orderId, lineNo, reason, source }) => [
    orderId, lineNo, source.order_date, source.order_vendor, source.code, source.name, source.unit_price, reason
  ].map((cell) => (/[",\n]/.test(String(cell)) ? `"${String(cell).replaceAll('"', '""')}"` : cell)).join(','))
].join('\r\n')}\r\n`;

const cell = (value) => (/[",\n]/.test(String(value ?? '')) ? `"${String(value).replaceAll('"', '""')}"` : String(value ?? ''));

/** Every line of orders that would not be attributed cleanly, with its planned decision. */
export const riskyOrdersCsv = ({ writes, reviews, mixedOrders, partialOrders }) => {
  const risky = new Map([...mixedOrders.map((id) => [id, '店家不一致']), ...partialOrders.map((id) => [id, '部分行需確認'])]);
  const lines = [...writes.map((row) => ({ row, decision: row.lineKind === 'ADJUSTMENT' ? '非餐點' : `${row.vendorId} ${row.itemCode}/${row.variantKey}` })),
    ...reviews.map((row) => ({ row, decision: `需確認：${row.reason}` }))]
    .filter(({ row }) => risky.has(row.orderId))
    .sort((a, b) => a.row.orderId.localeCompare(b.row.orderId) || a.row.lineNo - b.row.lineNo);
  return `\uFEFF${['風險,訂單,行,日期,狀態,店家,代碼,名稱,份數,計畫',
    ...lines.map(({ row, decision }) => [risky.get(row.orderId), row.orderId, row.lineNo, row.source.order_date,
      row.source.order_status, row.source.order_vendor, row.source.code, row.source.name, row.source.quantity, decision].map(cell).join(','))
  ].join('\r\n')}\r\n`;
};

const parseArgs = (argv) => {
  const args = { remote: false, localDb: '', reviewer: '', out: resolve(workerRoot, '.legacy-identity-report') };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--remote') args.remote = true;
    else if (value === '--local-db') args.localDb = argv[++index];
    else if (value === '--reviewer') args.reviewer = argv[++index];
    else if (value === '--out') args.out = resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (args.remote === Boolean(args.localDb)) throw new Error('Pass exactly one of --remote or --local-db <path>.');
  if (!args.reviewer) throw new Error('--reviewer <active Admin user_id> is required.');
  return args;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const query = args.remote ? remoteQuery : await localQuery(args.localDb);
  const context = buildContext({ catalogRows: query(CATALOG_SQL), vendorRows: query(VENDORS_SQL) });
  const plan = planIdentities(query(LINE_SQL), context);
  mkdirSync(args.out, { recursive: true });
  const sql = toInsertSql(plan.writes, { reviewerUserId: args.reviewer, reviewedAt: new Date().toISOString() });
  const sqlPath = resolve(args.out, 'apply-identities.sql');
  writeFileSync(sqlPath, `${sql.join('\n')}\n`, 'utf8');
  writeFileSync(resolve(args.out, 'needs-review.csv'), reviewCsv(plan.reviews), 'utf8');
  writeFileSync(resolve(args.out, 'risky-orders.csv'), riskyOrdersCsv(plan), 'utf8');
  const summary = summarize(plan);
  writeFileSync(resolve(args.out, 'plan-summary.md'), summary, 'utf8');
  console.log(summary);
  console.log(`SQL (not executed): ${sqlPath}`);
};

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
