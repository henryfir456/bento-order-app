import { getTaipeiDate, isDateOnly } from './deadlines.js';
import { HISTORICAL_MENU_ITEM_CODE_ALIASES } from './menu.js';
import { createEffectiveOrderItemNameResolver } from './effectiveOrderItemNames.js';

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

export const isHistoricalOrderDate = (orderDate, now = new Date()) => (
  isDateOnly(orderDate) && orderDate < getTaipeiDate(now)
);

export const orderStatusPredicate = ({ alias = 'o', includeCompleted = false } = {}) => (
  includeCompleted
    ? `${alias}.status IN ('ACTIVE', 'COMPLETED')`
    : `${alias}.status = 'ACTIVE'`
);

export const getActiveOrdersMap = async (database, userId) => {
  const result = await database.prepare(`
    SELECT order_date
    FROM orders
    WHERE user_id = ? AND ${orderStatusPredicate({ alias: 'orders' })}
    ORDER BY order_date ASC
  `).bind(userId).all();
  return rowsFrom(result).reduce((map, row) => {
    map[row.order_date] = true;
    return map;
  }, {});
};

export const getHistoricalOrdersMap = async (database, userId, now = new Date()) => {
  const today = getTaipeiDate(now);
  const result = await database.prepare(`
    SELECT order_date
    FROM orders
    WHERE user_id = ?
      AND (
        status = 'ACTIVE'
        OR (status = 'COMPLETED' AND order_date < ?)
      )
    ORDER BY order_date ASC
  `).bind(userId, today).all();
  return rowsFrom(result).reduce((map, row) => {
    map[row.order_date] = true;
    return map;
  }, {});
};

const textValue = (value) => String(value ?? '');

export const getOrderItemSelectionKey = (row, menuItems = []) => {
  const directMatch = row?.menu_item_id
    ? menuItems.find((item) => textValue(item?.menu_item_id) === textValue(row.menu_item_id))
    : null;
  if (directMatch) {
    return textValue(directMatch.selection_key || directMatch.menu_item_id || directMatch.item_id) || null;
  }

  const sourceCode = textValue(row?.legacy_item_id);
  const menuCode = HISTORICAL_MENU_ITEM_CODE_ALIASES[sourceCode] || sourceCode;
  const exactMatches = menuItems.filter((item) => (
    textValue(item?.legacy_item_id || item?.item_id) === menuCode
    && textValue(item?.item_name) === textValue(row?.item_name_snapshot)
    && Number(item?.price) === Number(row?.unit_price)
  ));
  if (exactMatches.length !== 1) return null;
  return textValue(exactMatches[0].selection_key || exactMatches[0].menu_item_id || exactMatches[0].item_id) || null;
};

export const getReadableOrder = async (
  database,
  userId,
  orderDate,
  { includeCompleted = false, menuItems = [] } = {}
) => {
  const order = await database.prepare(`
    SELECT order_id, order_date, vendor, pickup_floor, note, total_amount,
           status
    FROM orders o
    WHERE o.user_id = ? AND o.order_date = ?
      AND ${orderStatusPredicate({ alias: 'o', includeCompleted })}
    ORDER BY created_at DESC, order_id DESC
    LIMIT 1
  `).bind(userId, orderDate).first();
  if (!order) return {
    orderId: '',
    items: [],
    note: '',
    status: null,
    readOnly: false
  };

  const result = await database.prepare(`
    SELECT order_id, line_no, menu_item_id, legacy_item_id,
           item_name_snapshot, quantity, unit_price, subtotal
    FROM order_items
    WHERE order_id = ?
    ORDER BY line_no ASC
  `).bind(order.order_id).all();
  return {
    orderId: order.order_id,
    note: order.note || '',
    status: order.status,
    readOnly: order.status === 'COMPLETED',
    totalAmount: Number(order.total_amount),
    items: rowsFrom(result).map((row) => ({
      order_id: row.order_id,
      menu_item_id: row.menu_item_id,
      item_id: row.legacy_item_id,
      legacy_item_id: row.legacy_item_id,
      selection_key: getOrderItemSelectionKey(row, menuItems),
      item_name: row.item_name_snapshot,
      quantity: Number(row.quantity),
      unit_price: Number(row.unit_price),
      subtotal: Number(row.subtotal)
    }))
  };
};

export const getActiveOrder = async (database, userId, orderDate) => (
  getReadableOrder(database, userId, orderDate)
);

/** Server-authoritative historical order snapshots, including item details.
 * Returns only orders owned by the authorized subject selected by the route.
 */
export const getHistoricalOrderSummaries = async (database, userId, now = new Date()) => {
  const today = getTaipeiDate(now);
  const result = await database.prepare(`
    SELECT o.order_id, o.order_date, o.status, o.vendor, o.pickup_floor, o.note, o.total_amount,
           i.line_no, i.item_name_snapshot, i.quantity, i.unit_price, i.subtotal
    FROM orders o
    LEFT JOIN order_items i ON i.order_id = o.order_id
    WHERE o.user_id = ?
      AND (o.status = 'ACTIVE' OR (o.status = 'COMPLETED' AND o.order_date < ?))
    ORDER BY o.order_date DESC, o.order_id DESC, i.line_no ASC
  `).bind(userId, today).all();
  const byId = new Map();
  for (const row of rowsFrom(result)) {
    let order = byId.get(row.order_id);
    if (!order) {
      order = {
        orderId: row.order_id,
        date: row.order_date,
        status: row.status,
        vendor: row.vendor || '',
        floor: row.pickup_floor || '',
        note: row.note || '',
        totalAmount: Number(row.total_amount || 0),
        items: []
      };
      byId.set(row.order_id, order);
    }
    if (row.line_no !== null && row.line_no !== undefined) {
      order.items.push({
        name: row.item_name_snapshot || '',
        quantity: Number(row.quantity || 0),
        unitPrice: Number(row.unit_price || 0),
        subtotal: Number(row.subtotal || 0)
      });
    }
  }
  return [...byId.values()];
};


const EXCLUDED_STATISTIC_ITEM_NAMES = Object.freeze([
  '手續費減免',
  '免費加飯',
  '1元'
]);

/** Aggregate only the authenticated purchaser's valid, non-refunded order snapshots. */
export const getOrderStatistics = async (
  database,
  userId,
  { period = 'all', now = new Date() } = {}
) => {
  if (!['all', 'year', 'month'].includes(period)) {
    throw new TypeError('INVALID_STATISTICS_PERIOD');
  }

  const endDate = getTaipeiDate(now);
  const startDate = period === 'year'
    ? endDate.slice(0, 4) + '-01-01'
    : period === 'month'
      ? endDate.slice(0, 7) + '-01'
      : null;
  const rangePredicate = startDate ? '\n      AND o.order_date >= ?' : '';
  const bindings = [
    userId,
    endDate,
    ...(startDate ? [startDate] : [])
  ];
  const result = await database.prepare(`
    SELECT o.order_id, o.order_date,
           COALESCE(NULLIF(TRIM(o.vendor), ''), '未命名店家') AS vendor,
           i.line_no, i.menu_item_id, i.legacy_item_id, i.item_name_snapshot,
           i.quantity, i.unit_price
    FROM orders o
    JOIN order_items i ON i.order_id = o.order_id
    WHERE o.user_id = ?
      AND o.order_date <= ?
      AND o.status IN ('ACTIVE', 'COMPLETED')${rangePredicate}
      AND NOT EXISTS (
        SELECT 1
        FROM balance_ledger refund
        WHERE refund.reference_id = o.order_id
          AND refund.type = 'REFUND'
      )
    ORDER BY o.order_date ASC, vendor ASC, o.order_id ASC, i.line_no ASC
  `).bind(...bindings).all();

  const days = new Set();
  const mealTypes = new Set();
  const vendorsByName = new Map();
  const itemsByIdentity = new Map();
  let totalPortions = 0;
  const resolveName = createEffectiveOrderItemNameResolver(database);

  for (const row of rowsFrom(result)) {
    const effectiveItem = await resolveName({
      vendor: row.vendor,
      orderDate: row.order_date,
      item: {
        menu_item_id: row.menu_item_id,
        legacy_item_id: row.legacy_item_id,
        item_name_snapshot: row.item_name_snapshot,
        unit_price: row.unit_price,
        fallbackKey: `${row.order_id}:${row.line_no}`
      }
    });
    if (EXCLUDED_STATISTIC_ITEM_NAMES.includes(String(row.item_name_snapshot || ''))
      || EXCLUDED_STATISTIC_ITEM_NAMES.includes(effectiveItem.itemName)) continue;
    const portions = Number(row.quantity || 0);
    const vendor = String(effectiveItem.vendor || row.vendor || '未命名店家');
    const name = String(effectiveItem.itemName || '');
    totalPortions += portions;
    days.add(row.order_date);
    mealTypes.add(effectiveItem.identityKey);
    vendorsByName.set(vendor, (vendorsByName.get(vendor) || 0) + portions);
    const existing = itemsByIdentity.get(effectiveItem.identityKey) || {
      name,
      identityKey: effectiveItem.identityKey,
      vendor: effectiveItem.vendor,
      variantKey: effectiveItem.variantKey,
      portions: 0
    };
    // Rows are ordered by effective order date, so retain the latest menu
    // label when the same stable meal identity was renamed over time.
    existing.name = name;
    existing.portions += portions;
    itemsByIdentity.set(effectiveItem.identityKey, existing);
  }

  const byPortionsThenName = (left, right) => (
    right.portions - left.portions || left.name.localeCompare(right.name, 'zh-TW')
  );
  const vendors = [...vendorsByName.entries()]
    .map(([name, portions]) => ({ name, portions }))
    .sort(byPortionsThenName);
  const items = [...itemsByIdentity.values()]
    .sort((left, right) => byPortionsThenName(left, right)
      || left.vendor.localeCompare(right.vendor, 'zh-TW')
      || left.variantKey.localeCompare(right.variantKey, 'zh-TW'));

  return {
    period,
    startDate,
    endDate,
    totalPortions,
    totalOrderDays: days.size,
    totalMealTypes: mealTypes.size,
    vendors,
    items
  };
};
