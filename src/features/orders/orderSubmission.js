export const buildOrderSubmission = ({
  menu = [],
  orderItems = {},
  selectedDate = '',
  vendor = '',
  floor = '',
  note = '',
  workerOrderMutation = false
} = {}) => {
  const items = Object.entries(orderItems)
    .map(([item_id, quantity]) => {
      const menuItem = menu.find(item => item.item_id === item_id);
      return {
        item_id,
        ...(workerOrderMutation && menuItem?.menu_item_id
          ? { menu_item_id: menuItem.menu_item_id }
          : {}),
        item_name: menuItem?.item_name || '',
        quantity,
        unit_price: menuItem?.price || 0
      };
    })
    .filter(item => item.quantity > 0);

  return {
    targetDate: selectedDate || '',
    ...(vendor ? { vendor } : {}),
    pickupFloor: floor || '',
    items,
    note,
    totalCount: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    totalAmount: items.reduce((sum, item) => sum + (Number(item.unit_price || 0) * Number(item.quantity || 0)), 0)
  };
};

export const buildExistingOrderSubmission = ({
  order = {},
  selectedDate = '',
  vendor = '',
  fallbackFloor = ''
} = {}) => {
  const items = (Array.isArray(order.items) ? order.items : [])
    .map((item, index) => {
      const itemId = String(item?.menu_item_id || item?.item_id || `order-item-${index}`);
      const quantity = Number(item?.quantity || 0);
      const unitPrice = Number(item?.unit_price || 0);
      const storedSubtotal = Number(item?.subtotal);
      return {
        item_id: itemId,
        item_name: item?.item_name || item?.item_name_snapshot || itemId,
        quantity,
        unit_price: unitPrice,
        subtotal: Number.isFinite(storedSubtotal) ? storedSubtotal : unitPrice * quantity
      };
    })
    .filter(item => item.quantity > 0);
  const storedTotal = Number(order.totalAmount ?? order.total_amount);

  return {
    targetDate: selectedDate || '',
    vendor: order.vendor || vendor || '',
    pickupFloor: order.pickupFloor || order.pickup_floor || order.floor || fallbackFloor || '',
    items,
    note: String(order.note || ''),
    totalCount: items.reduce((sum, item) => sum + item.quantity, 0),
    totalAmount: Number.isFinite(storedTotal)
      ? storedTotal
      : items.reduce((sum, item) => sum + item.subtotal, 0)
  };
};
