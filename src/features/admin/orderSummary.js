const floorNumber = (floor) => {
  const match = String(floor || '').match(/^(\d+)/);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
};

export const ORDER_SUMMARY_TABS = Object.freeze([
  { id: 'detail', label: '明細' },
  { id: 'floorCount', label: '樓層數' },
  { id: 'totalCount', label: '總數' }
]);

export const compareFloors = (left, right) => {
  const leftNumber = floorNumber(left);
  const rightNumber = floorNumber(right);
  if (leftNumber !== rightNumber) return leftNumber - rightNumber;
  return String(left).localeCompare(String(right), 'zh-Hant');
};

export const groupOrdersByFloor = (orders = []) => {
  const groups = new Map();
  (Array.isArray(orders) ? orders : []).forEach((order) => {
    const floor = String(order?.pickup_floor || '其他').trim() || '其他';
    if (!groups.has(floor)) groups.set(floor, []);
    groups.get(floor).push(order);
  });

  return Array.from(groups.entries())
    .sort(([left], [right]) => compareFloors(left, right))
    .map(([floor, floorOrders]) => ({ floor, orders: floorOrders }));
};

export const aggregateOrdersByFloor = (orders = []) => (
  groupOrdersByFloor(orders).map(({ floor, orders: floorOrders }) => {
    const items = new Map();
    floorOrders.forEach((order) => {
      const itemName = String(order?.item_name || '未命名品項').trim() || '未命名品項';
      const quantity = Number(order?.quantity || 0);
      if (!Number.isFinite(quantity)) return;
      items.set(itemName, (items.get(itemName) || 0) + quantity);
    });
    return {
      floor,
      items: Array.from(items.entries()).map(([itemName, quantity]) => ({ itemName, quantity }))
    };
  })
);

export const aggregateOrdersByItem = (orders = []) => {
  const items = new Map();
  (Array.isArray(orders) ? orders : []).forEach((order) => {
    const itemName = String(order?.item_name || '未命名品項').trim() || '未命名品項';
    const quantity = Number(order?.quantity || 0);
    if (!Number.isFinite(quantity)) return;
    items.set(itemName, (items.get(itemName) || 0) + quantity);
  });

  return Array.from(items.entries()).map(([itemName, quantity]) => ({ itemName, quantity }));
};
