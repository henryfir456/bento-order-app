// Read-only report: how every stored order line maps to a canonical vendor and
// normalized menu identity (item code + variant). It groups lines by their raw
// snapshot (vendor, code, name, price, stored menu item) and proposes the
// official menu item each group should point to, with the evidence used.
//
// The output contains only shop names, dish codes/names, prices, dates and
// counts. It never reads or writes users, employee IDs or LINE identities.
//
//   node scripts/legacy-order-identity-report.mjs --remote [--out <dir>]
//   node scripts/legacy-order-identity-report.mjs --local-db <path> [--out <dir>]
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HISTORICAL_MENU_ITEM_CODE_ALIASES } from '../src/domain/menu.js';
import {
  legacyItemHasHalfVariant,
  normalizeLegacyMenuIdentity
} from '../src/domain/menuItemChanges.js';
import { normalizeMenuItemName, normalizeMenuVendor } from '../src/domain/menuVendors.js';

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const text = (value) => String(value ?? '').trim();

export const ORDER_LINE_GROUPS_SQL = `
WITH latest_map AS (
  SELECT m.menu_version_id, m.vendor_id
  FROM vendor_menu_version_mapping_events m
  WHERE m.mapping_status = 'VERIFIED'
    AND m.revision = (
      SELECT MAX(r.revision) FROM vendor_menu_version_mapping_events r
      WHERE r.menu_version_id = m.menu_version_id
    )
)
SELECT
  o.vendor AS order_vendor,
  COALESCE(o.vendor_id, '') AS order_vendor_id,
  COALESCE(attr.vendor_id, '') AS attributed_vendor_id,
  o.created_auth_mode AS auth_mode,
  COALESCE(oi.legacy_item_id, '') AS code,
  oi.item_name_snapshot AS name,
  oi.unit_price AS unit_price,
  CASE WHEN oi.menu_item_id IS NULL THEN 'none'
       WHEN mi.menu_item_id IS NULL THEN 'dangling'
       ELSE 'linked' END AS menu_ref,
  COALESCE(mi.legacy_item_id, '') AS mi_code,
  COALESCE(mi.variant_key, '') AS mi_variant,
  COALESCE(mi.item_name, '') AS mi_name,
  COALESCE(mv.vendor, '') AS mv_vendor,
  COALESCE(lm.vendor_id, '') AS mv_mapped_vendor_id,
  COUNT(*) AS lines,
  SUM(oi.quantity) AS qty,
  SUM(CASE WHEN o.status <> 'CANCELLED' THEN oi.quantity ELSE 0 END) AS qty_kept,
  MIN(o.order_date) AS first_date,
  MAX(o.order_date) AS last_date
FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id
LEFT JOIN menu_items mi ON mi.menu_item_id = oi.menu_item_id
LEFT JOIN menu_versions mv ON mv.menu_version_id = mi.menu_version_id
LEFT JOIN latest_map lm ON lm.menu_version_id = mv.menu_version_id
LEFT JOIN vendor_order_vendor_attributions_live attr ON attr.order_id = o.order_id
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13
ORDER BY 1, 5, 6, 7`;

export const CATALOG_SQL = `
SELECT c.vendor, c.item_code, c.variant_key, c.item_name, c.price, c.enabled,
  c.effective_date, COALESCE(s.sequence_number, 0) AS sequence_number
FROM menu_item_changes c
LEFT JOIN menu_item_change_sequence s ON s.menu_item_change_id = c.menu_item_change_id
WHERE c.identity_schema_version = 2`;

export const VENDORS_SQL = 'SELECT vendor_id, name FROM vendors';

export const STATUS = Object.freeze({
  OK: '一致',
  CODE: '依代碼對應',
  HALF_BY_NAME: '依名稱推測半飯',
  CONFLICT: '代碼與菜單品項衝突',
  NO_MATCH: '無法對應'
});

const identityKey = (vendor, itemCode, variantKey) => `${vendor}\u0000${itemCode}\u0000${variantKey}`;

/** Latest normalized (schema v2) catalog row per vendor/item code/variant. */
export const latestCatalog = (rows = []) => {
  const latest = new Map();
  rows.forEach((row) => {
    const vendor = normalizeMenuVendor(row.vendor);
    const key = identityKey(vendor, text(row.item_code).toUpperCase(), text(row.variant_key).toUpperCase());
    const previous = latest.get(key);
    const newer = !previous
      || text(row.effective_date) > text(previous.effective_date)
      || (text(row.effective_date) === text(previous.effective_date)
        && Number(row.sequence_number) > Number(previous.sequence_number));
    if (newer) latest.set(key, row);
  });
  return latest;
};

const canonicalCode = (code) => HISTORICAL_MENU_ITEM_CODE_ALIASES[text(code)] || text(code);

const projectIdentity = ({ vendor, code, variant, name }) => {
  if (!text(code)) return null;
  const mapped = normalizeLegacyMenuIdentity({ vendor, itemCode: canonicalCode(code), variantKey: variant, itemName: name });
  if (mapped) return { item_code: mapped.item_code.toUpperCase(), variant_key: mapped.variant_key };
  return null;
};

/**
 * Classify one group of identical order-line snapshots and propose the
 * canonical vendor and normalized identity it should be stored under.
 */
export const classifyGroup = (group, { vendorIdsByName = new Map(), catalog = new Map() } = {}) => {
  const vendor = normalizeMenuVendor(group.order_vendor);
  const proposedVendorId = vendorIdsByName.get(vendor) || '';
  const fromCode = projectIdentity({ vendor, code: group.code, variant: group.mi_variant, name: group.name });
  const fromMenuItem = group.menu_ref === 'linked'
    ? projectIdentity({
      vendor: normalizeMenuVendor(group.mv_vendor) || vendor,
      code: group.mi_code,
      variant: group.mi_variant,
      name: group.mi_name
    })
    : null;
  const nameSaysHalf = text(group.name).includes('半飯');
  const notes = [];
  let proposal = fromCode || fromMenuItem;
  let status = proposal ? STATUS.CODE : STATUS.NO_MATCH;
  let evidence = fromCode ? '代碼' : fromMenuItem ? '原菜單品項' : '';

  if (fromCode && fromMenuItem
    && (fromCode.item_code !== fromMenuItem.item_code || fromCode.variant_key !== fromMenuItem.variant_key)) {
    status = STATUS.CONFLICT;
    notes.push(`代碼指向 ${fromCode.item_code}/${fromCode.variant_key}，原菜單品項是 ${fromMenuItem.item_code}/${fromMenuItem.variant_key}`);
    // The stored menu item's HALF is stronger than a shared base code.
    if (fromMenuItem.item_code === fromCode.item_code && fromMenuItem.variant_key === 'HALF') {
      proposal = fromMenuItem;
      evidence = '原菜單品項（半飯）';
    }
  }
  if (proposal && proposal.variant_key === 'BASE' && nameSaysHalf
    && legacyItemHasHalfVariant({ vendor, itemCode: proposal.item_code })) {
    proposal = { item_code: proposal.item_code, variant_key: 'HALF' };
    status = STATUS.HALF_BY_NAME;
    evidence = '代碼 + 名稱含「半飯」';
  }

  const official = proposal ? catalog.get(identityKey(vendor, proposal.item_code, proposal.variant_key)) : null;
  if (proposal && !official) notes.push('正式菜單找不到此代碼/規格');
  if (!proposedVendorId) notes.push('vendors 表找不到此店名');
  if (group.menu_ref === 'dangling') notes.push('menu_item_id 指向不存在的菜單品項');
  if (status === STATUS.CODE && group.menu_ref === 'linked' && text(group.order_vendor_id)
    && text(group.order_vendor_id) === proposedVendorId) {
    status = STATUS.OK;
  }
  if (status === STATUS.CODE && official
    && normalizeMenuItemName(official.item_name) === normalizeMenuItemName(group.name)) {
    evidence += '，名稱相同';
  }

  return {
    status,
    vendor,
    proposedVendorId,
    currentVendorId: text(group.order_vendor_id),
    attributedVendorId: text(group.attributed_vendor_id),
    authMode: text(group.auth_mode),
    code: text(group.code),
    name: text(group.name),
    unitPrice: group.unit_price,
    menuRef: group.menu_ref,
    storedMenuItem: group.menu_ref === 'linked'
      ? [text(group.mi_code), text(group.mi_variant), text(group.mi_name)].join(' / ')
      : '',
    proposedCode: proposal?.item_code || '',
    proposedVariant: proposal?.variant_key || '',
    officialName: official ? text(official.item_name) : '',
    officialPrice: official ? official.price : '',
    evidence,
    lines: Number(group.lines) || 0,
    qty: Number(group.qty) || 0,
    qtyKept: Number(group.qty_kept) || 0,
    firstDate: text(group.first_date),
    lastDate: text(group.last_date),
    notes: notes.join('；')
  };
};

export const buildReport = ({ groups = [], catalogRows = [], vendorRows = [] } = {}) => {
  const vendorIdsByName = new Map(vendorRows.map((row) => [normalizeMenuVendor(row.name), text(row.vendor_id)]));
  const catalog = latestCatalog(catalogRows);
  return groups.map((group) => classifyGroup(group, { vendorIdsByName, catalog }));
};

const CSV_COLUMNS = [
  ['status', '狀態'],
  ['vendor', '店家'],
  ['currentVendorId', '訂單 vendor_id'],
  ['attributedVendorId', '目前歸屬 vendor_id'],
  ['proposedVendorId', '建議 vendor_id'],
  ['code', '原代碼'],
  ['name', '原品項名稱'],
  ['unitPrice', '單價'],
  ['storedMenuItem', '原菜單品項（代碼/規格/名稱）'],
  ['proposedCode', '建議代碼'],
  ['proposedVariant', '建議規格'],
  ['officialName', '正式菜單名稱'],
  ['officialPrice', '正式菜單價格'],
  ['evidence', '依據'],
  ['lines', '筆數'],
  ['qty', '份數'],
  ['qtyKept', '份數（不含取消）'],
  ['firstDate', '最早日期'],
  ['lastDate', '最晚日期'],
  ['authMode', '建立方式'],
  ['notes', '備註']
];

const csvCell = (value) => {
  const raw = String(value ?? '');
  return /[",\n\r]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
};

export const toCsv = (rows) => `﻿${[
  CSV_COLUMNS.map(([, label]) => label).join(','),
  ...rows.map((row) => CSV_COLUMNS.map(([key]) => csvCell(row[key])).join(','))
].join('\r\n')}\r\n`;

export const toSummary = (rows) => {
  const byStatus = new Map();
  const byVendor = new Map();
  rows.forEach((row) => {
    const status = byStatus.get(row.status) || { groups: 0, lines: 0, qty: 0 };
    status.groups += 1; status.lines += row.lines; status.qty += row.qty;
    byStatus.set(row.status, status);
    const vendor = byVendor.get(row.vendor) || { lines: 0, missingVendorId: 0, needsReview: 0 };
    vendor.lines += row.lines;
    if (!row.currentVendorId) vendor.missingVendorId += row.lines;
    if (row.status !== STATUS.OK && row.status !== STATUS.CODE) vendor.needsReview += row.lines;
    byVendor.set(row.vendor, vendor);
  });
  const lines = ['# 舊訂單品項對照摘要', '', '## 依狀態', '', '| 狀態 | 組數 | 筆數 | 份數 |', '| --- | ---: | ---: | ---: |'];
  Object.values(STATUS).forEach((name) => {
    const value = byStatus.get(name);
    if (value) lines.push(`| ${name} | ${value.groups} | ${value.lines} | ${value.qty} |`);
  });
  lines.push('', '## 依店家', '', '| 店家 | 筆數 | 缺 vendor_id | 需確認 |', '| --- | ---: | ---: | ---: |');
  [...byVendor.entries()].sort((a, b) => b[1].lines - a[1].lines).forEach(([vendor, value]) => {
    lines.push(`| ${vendor || '（空白）'} | ${value.lines} | ${value.missingVendorId} | ${value.needsReview} |`);
  });
  return `${lines.join('\n')}\n`;
};

const parseArgs = (argv) => {
  const args = { remote: false, localDb: '', out: resolve(workerRoot, '.legacy-identity-report') };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--remote') args.remote = true;
    else if (value === '--local-db') args.localDb = argv[++index];
    else if (value === '--out') args.out = resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (args.remote === Boolean(args.localDb)) throw new Error('Pass exactly one of --remote or --local-db <path>.');
  return args;
};

export const remoteQuery = (sql) => {
  const result = spawnSync(process.execPath, [
    resolve(workerRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    'd1', 'execute', 'bento-formal', '--remote', '--json',
    '--config', resolve(workerRoot, 'wrangler.jsonc'),
    '--command', sql.replace(/\s+/g, ' ').trim()
  ], { cwd: workerRoot, encoding: 'utf8', shell: false, maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`wrangler d1 execute failed:\n${result.stderr || result.stdout}`);
  }
  const parsed = JSON.parse(result.stdout);
  return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((entry) => entry.results || []);
};

export const localQuery = async (path) => {
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(path, { readOnly: true });
  return (sql) => database.prepare(sql).all();
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const query = args.remote ? remoteQuery : await localQuery(args.localDb);
  const rows = buildReport({
    groups: query(ORDER_LINE_GROUPS_SQL),
    catalogRows: query(CATALOG_SQL),
    vendorRows: query(VENDORS_SQL)
  });
  mkdirSync(args.out, { recursive: true });
  const csvPath = resolve(args.out, 'legacy-order-identity-report.csv');
  const summaryPath = resolve(args.out, 'legacy-order-identity-summary.md');
  writeFileSync(csvPath, toCsv(rows), 'utf8');
  writeFileSync(summaryPath, toSummary(rows), 'utf8');
  console.log(toSummary(rows));
  console.log(`CSV: ${csvPath}\nSummary: ${summaryPath}`);
};

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
