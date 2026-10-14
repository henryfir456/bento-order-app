import { getTaipeiDate, isDateOnly } from './deadlines.js';
import { HISTORICAL_MENU_ITEM_CODE_ALIASES } from './menu.js';

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
