const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

export const getActiveOrdersMap = async (database, lineUserId) => {
  const result = await database.prepare(`
    SELECT order_date
    FROM orders
    WHERE line_user_id = ? AND status = 'ACTIVE'
    ORDER BY order_date ASC
  `).bind(lineUserId).all();
  return rowsFrom(result).reduce((map, row) => {
    map[row.order_date] = true;
    return map;
  }, {});
};

export const getActiveOrder = async (database, lineUserId, orderDate) => {
  const order = await database.prepare(`
    SELECT order_id, order_date, vendor, pickup_floor, note, total_amount
    FROM orders
    WHERE line_user_id = ? AND order_date = ? AND status = 'ACTIVE'
    ORDER BY created_at DESC, order_id DESC
    LIMIT 1
  `).bind(lineUserId, orderDate).first();
  if (!order) return { orderId: '', items: [], note: '' };

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
    totalAmount: Number(order.total_amount),
    items: rowsFrom(result).map((row) => ({
      order_id: row.order_id,
      menu_item_id: row.menu_item_id,
      item_id: row.legacy_item_id,
      legacy_item_id: row.legacy_item_id,
      item_name: row.item_name_snapshot,
      quantity: Number(row.quantity),
      unit_price: Number(row.unit_price),
      subtotal: Number(row.subtotal)
    }))
  };
};
