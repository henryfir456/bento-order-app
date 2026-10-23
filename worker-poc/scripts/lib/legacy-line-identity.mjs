// Rules that turn each stored legacy order line into a reviewed canonical
// identity (vendor + normalized item code + variant, or a non-meal adjustment).
// Pure functions: the apply script feeds them rows and emits INSERT statements
// for order_line_canonical_identities. Lines the rules cannot settle are
// returned for manual review and never written.
import { classifyGroup, latestCatalog, STATUS } from '../legacy-order-identity-report.mjs';
import { normalizeMenuItemName, normalizeMenuVendor } from '../../src/domain/menuVendors.js';

const text = (value) => String(value ?? '').trim();

export const HE_SHI = '禾拾';
export const CAI_TEACHER = '蔡老師';
// Non-meal adjustment codes Henry approved on 2026-10-23: a 1-yuan placeholder
// item and a fee waiver. They keep their amounts but are not portions.
const ADJUSTMENT_CODES = new Set(['FR1', 'REVERT1']);
// Pre-launch 禾拾 meals were imported under 蔡老師 with H1–H5 codes whose
// numbering differed from today's menu, so they are matched by dish name only.
const MIGRATED_CODES = /^H[1-5]$/i;

// 蕃/番 are used interchangeably for 蕃茄 in old names. Henry confirmed on
// 2026-10-23 that the old 紅麴腐乳板豆腐 is today's 紅麴豆腐.
const dishKey = (name) => normalizeMenuItemName(name)
  .replace(/[（(]\s*半飯\s*[）)]/gu, '')
  .replace(/番/gu, '蕃')
  .replace(/\s+/gu, '')
  .replace(/^紅麴腐乳板豆腐$/u, '紅麴豆腐');

export const SOURCE_BASIS = Object.freeze({
  CODE: 'LEGACY_CODE_MAP',
  STORED_HALF: 'STORED_HALF_MENU_ITEM',
  NAME_HALF: 'NAME_HALF_CONFIRMED',
  NAME_TO_MENU: 'NAME_TO_CURRENT_MENU',
  ADJUSTMENT: 'NON_MEAL_ADJUSTMENT'
});

const heShiNameIndex = (catalog) => {
  const byName = new Map();
  for (const row of catalog.values()) {
    if (normalizeMenuVendor(row.vendor) !== HE_SHI || text(row.variant_key).toUpperCase() !== 'BASE') continue;
    const key = dishKey(row.item_name);
    byName.set(key, [...(byName.get(key) || []), text(row.item_code).toUpperCase()]);
  }
  return byName;
};

export const buildContext = ({ catalogRows = [], vendorRows = [] } = {}) => {
  const catalog = latestCatalog(catalogRows);
  return {
    catalog,
    vendorIdsByName: new Map(vendorRows.map((row) => [normalizeMenuVendor(row.name), text(row.vendor_id)])),
    heShiNames: heShiNameIndex(catalog)
  };
};

const review = (reason) => ({ action: 'REVIEW', reason });
const write = (fields) => ({ action: 'WRITE', ...fields });

/** Decide the canonical identity of one order line row (see LINE_SQL). */
export const resolveLine = (line, context) => {
  const code = text(line.code).toUpperCase();
  const vendor = normalizeMenuVendor(line.order_vendor);
  if (ADJUSTMENT_CODES.has(code) && line.menu_ref === 'none') {
    return write({ lineKind: 'ADJUSTMENT', basis: SOURCE_BASIS.ADJUSTMENT });
  }
  if (vendor === CAI_TEACHER && MIGRATED_CODES.test(code) && line.menu_ref === 'none') {
    const matches = context.heShiNames.get(dishKey(line.name)) || [];
    if (matches.length !== 1) return review('舊禾拾品項名稱對不上現行菜單');
    return write({
      lineKind: 'MEAL',
      vendorId: context.vendorIdsByName.get(HE_SHI) || '',
      itemCode: matches[0],
      variantKey: text(line.name).includes('半飯') ? 'HALF' : 'BASE',
      basis: SOURCE_BASIS.NAME_TO_MENU
    });
  }
  const group = classifyGroup(line, { vendorIdsByName: context.vendorIdsByName, catalog: context.catalog });
  if (!group.proposedCode || !group.officialName) return review(group.notes || '無法對應');
  if (!group.proposedVendorId) return review('找不到店家 vendor_id');
  const basis = group.status === STATUS.HALF_BY_NAME
    ? SOURCE_BASIS.NAME_HALF
    : group.status === STATUS.CONFLICT ? SOURCE_BASIS.STORED_HALF : SOURCE_BASIS.CODE;
  return write({
    lineKind: 'MEAL',
    vendorId: group.proposedVendorId,
    itemCode: group.proposedCode,
    variantKey: group.proposedVariant,
    basis
  });
};

export const LINE_SQL = `
SELECT
  o.order_id AS order_id,
  oi.line_no AS line_no,
  o.order_date AS order_date,
  o.status AS order_status,
  o.vendor AS order_vendor,
  COALESCE(o.vendor_id, '') AS order_vendor_id,
  '' AS attributed_vendor_id,
  o.created_auth_mode AS auth_mode,
  COALESCE(oi.legacy_item_id, '') AS code,
  oi.item_name_snapshot AS name,
  oi.unit_price AS unit_price,
  oi.quantity AS quantity,
  CASE WHEN oi.menu_item_id IS NULL THEN 'none'
       WHEN mi.menu_item_id IS NULL THEN 'dangling'
       ELSE 'linked' END AS menu_ref,
  COALESCE(mi.legacy_item_id, '') AS mi_code,
  COALESCE(mi.variant_key, '') AS mi_variant,
  COALESCE(mi.item_name, '') AS mi_name,
  COALESCE(mv.vendor, '') AS mv_vendor,
  1 AS lines,
  oi.quantity AS qty,
  CASE WHEN o.status <> 'CANCELLED' THEN oi.quantity ELSE 0 END AS qty_kept,
  o.order_date AS first_date,
  o.order_date AS last_date,
  EXISTS (
    SELECT 1 FROM order_line_current_identities done
    WHERE done.order_id = oi.order_id AND done.line_no = oi.line_no
  ) AS already_identified
FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id
LEFT JOIN menu_items mi ON mi.menu_item_id = oi.menu_item_id
LEFT JOIN menu_versions mv ON mv.menu_version_id = mi.menu_version_id
ORDER BY o.order_id, oi.line_no`;

/**
 * Plan the overlay for every line not yet identified. Returns the rows to
 * write, the lines needing review, and orders whose reviewed MEAL lines would
 * disagree on a vendor (those orders are not attributed until fixed).
 */
export const planIdentities = (lineRows, context) => {
  const writes = [];
  const reviews = [];
  for (const line of lineRows) {
    if (Number(line.already_identified)) continue;
    const decision = resolveLine(line, context);
    const identified = { orderId: line.order_id, lineNo: Number(line.line_no) };
    if (decision.action === 'WRITE') writes.push({ ...identified, ...decision, source: line });
    else reviews.push({ ...identified, reason: decision.reason, source: line });
  }
  const vendorsByOrder = new Map();
  writes.filter((row) => row.lineKind === 'MEAL').forEach((row) => {
    vendorsByOrder.set(row.orderId, new Set([...(vendorsByOrder.get(row.orderId) || []), row.vendorId]));
  });
  const mixedOrders = [...vendorsByOrder.entries()].filter(([, vendors]) => vendors.size > 1).map(([orderId]) => orderId);
  const reviewOrders = new Set(reviews.map((row) => row.orderId));
  const partialOrders = [...new Set(writes.map((row) => row.orderId))].filter((orderId) => reviewOrders.has(orderId));
  return { writes, reviews, mixedOrders, partialOrders };
};

const sqlText = (value) => (value === null || value === undefined ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`);

/** INSERT statements (one per line) for the planned rows. */
export const toInsertSql = (writes, { reviewerUserId, reviewedAt }) => writes.map((row) => (
  'INSERT INTO order_line_canonical_identities '
  + '(order_id, line_no, revision, line_kind, vendor_id, item_code, variant_key, basis, reviewed_by_user_id, reviewed_at) '
  + `VALUES (${sqlText(row.orderId)}, ${row.lineNo}, `
  + `COALESCE((SELECT MAX(revision) + 1 FROM order_line_canonical_identities p WHERE p.order_id = ${sqlText(row.orderId)} AND p.line_no = ${row.lineNo}), 1), `
  + `${sqlText(row.lineKind)}, ${sqlText(row.vendorId ?? null)}, ${sqlText(row.itemCode ?? null)}, ${sqlText(row.variantKey ?? null)}, `
  + `${sqlText(row.basis)}, ${sqlText(reviewerUserId)}, ${sqlText(reviewedAt)});`
));
