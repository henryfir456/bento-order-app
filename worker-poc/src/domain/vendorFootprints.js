import { getTaipeiDate } from './deadlines.js';
import {
  REVIEWED_IDENTITY_COLUMNS,
  createEffectiveOrderItemNameResolver,
  reviewedIdentityJoin,
  reviewedIdentityOf
} from './effectiveOrderItemNames.js';
import { HISTORICAL_MENU_ITEM_CODE_ALIASES } from './menu.js';
import { EXCLUDED_STATISTIC_ITEM_NAMES } from './ordersRead.js';

const rowsFrom = (result) => (Array.isArray(result?.results) ? result.results : []);

export const VENDOR_FOOTPRINT_PERIODS = Object.freeze(['all', 'year', 'month']);

// What a vendor has sold: every attributed order of its vendors up to
// yesterday (today is still open), grouped by dish. ACTIVE orders and, like
// the Admin summary, COMPLETED imported history both count. Meal identity
// rules match the employee footprint: a line without a verified or reviewed
// identity is grouped by its own snapshot, never merged into another dish.
export const getVendorFootprints = async (database, vendors, { period = 'all', now = new Date() } = {}) => {
  if (!VENDOR_FOOTPRINT_PERIODS.includes(period)) throw new TypeError('INVALID_FOOTPRINT_PERIOD');
  const today = getTaipeiDate(now);
  const startDate = period === 'year'
    ? `${today.slice(0, 4)}-01-01`
    : period === 'month' ? `${today.slice(0, 7)}-01` : null;
  const resolveName = createEffectiveOrderItemNameResolver(database);
  const days = new Set();
  const mealTypes = new Set();
  const itemsByIdentity = new Map();
  let totalPortions = 0;
  let totalAmountTwd = 0;

  for (const vendor of vendors) {
    const result = await database.prepare(`
      SELECT o.order_id, o.order_date,
        oi.line_no, oi.menu_item_id, oi.legacy_item_id, oi.item_name_snapshot,
        oi.quantity, oi.unit_price, oi.subtotal,${REVIEWED_IDENTITY_COLUMNS}
      FROM orders o
      JOIN vendor_order_vendor_attributions attribution ON attribution.order_id = o.order_id
      JOIN order_items oi ON oi.order_id = o.order_id${reviewedIdentityJoin('oi')}
      WHERE attribution.vendor_id = ? AND o.order_date < ?${startDate ? ' AND o.order_date >= ?' : ''}
        AND o.status IN ('ACTIVE', 'COMPLETED')
      ORDER BY o.order_date ASC, o.order_id ASC, oi.line_no ASC
    `).bind(vendor.vendor_id, today, ...(startDate ? [startDate] : [])).all();
    const rows = rowsFrom(result).map((row) => ({ ...row, reviewed_identity: reviewedIdentityOf(row) }));
    await resolveName.prefetch(rows.map((row) => ({
      vendor: vendor.name,
      orderDate: row.order_date,
      item: { menu_item_id: row.menu_item_id, reviewed_identity: row.reviewed_identity }
    })));
    for (const row of rows) {
      const effective = await resolveName({ vendor: vendor.name, orderDate: row.order_date, item: row });
      const name = String(effective.itemName || '');
      if (effective.isAdjustment
        || EXCLUDED_STATISTIC_ITEM_NAMES.includes(String(row.item_name_snapshot || ''))
        || EXCLUDED_STATISTIC_ITEM_NAMES.includes(name)) continue;
      const portions = Number(row.quantity || 0);
      const groupKey = effective.resolved
        ? effective.identityKey
        : JSON.stringify([
          vendor.vendor_id, 'snapshot',
          HISTORICAL_MENU_ITEM_CODE_ALIASES[effective.itemCode] || effective.itemCode,
          effective.variantKey, name, Number(row.unit_price)
        ]);
      totalPortions += portions;
      totalAmountTwd += Number(row.subtotal || 0);
      days.add(row.order_date);
      mealTypes.add(groupKey);
      const existing = itemsByIdentity.get(groupKey) || {
        name,
        variantKey: effective.variantKey || '',
        resolved: Boolean(effective.resolved),
        portions: 0,
        amountTwd: 0
      };
      // Rows run oldest to newest, so a renamed dish keeps its latest label.
      existing.name = name;
      existing.portions += portions;
      existing.amountTwd += Number(row.subtotal || 0);
      itemsByIdentity.set(groupKey, existing);
    }
  }

  const items = [...itemsByIdentity.values()].sort((left, right) => (
    right.portions - left.portions
    || left.name.localeCompare(right.name, 'zh-TW')
    || left.variantKey.localeCompare(right.variantKey, 'zh-TW')
  ));
  return {
    period,
    startDate,
    // Through yesterday: today's orders can still change before the cutoff.
    endDate: today,
    totalPortions,
    totalAmountTwd,
    totalOrderDays: days.size,
    totalMealTypes: mealTypes.size,
    items
  };
};
