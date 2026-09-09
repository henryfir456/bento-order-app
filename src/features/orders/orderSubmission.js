export const buildOrderSubmission = ({
  menu = [],
  orderItems = {},
  selectedDate = '',
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
    pickupFloor: floor || '',
    items,
    note,
    totalCount: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    totalAmount: items.reduce((sum, item) => sum + (Number(item.unit_price || 0) * Number(item.quantity || 0)), 0)
  };
};