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

const itemIdentity = (order) => order?.item_identity_key
  || JSON.stringify([order?.item_vendor || order?.vendor || '', order?.item_name || '', order?.item_variant_key || '']);

export const formatOrderItemLabel = ({ itemName, vendor, variantKey } = {}) => (
  `${itemName || '未命名品項'}${vendor ? ` · ${vendor}` : ''}${variantKey ? ` · ${variantKey}` : ''}`
);

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
      const identityKey = itemIdentity(order);
      const item = items.get(identityKey) || {
        itemName,
        identityKey,
        vendor: order?.item_vendor || order?.vendor || '',
        variantKey: order?.item_variant_key || '',
        quantity: 0
      };
      item.quantity += quantity;
      items.set(identityKey, item);
    });
    return {
      floor,
      items: Array.from(items.values())
    };
  })
);

export const aggregateOrdersByItem = (orders = []) => {
  const items = new Map();
  (Array.isArray(orders) ? orders : []).forEach((order) => {
    const itemName = String(order?.item_name || '未命名品項').trim() || '未命名品項';
    const quantity = Number(order?.quantity || 0);
    if (!Number.isFinite(quantity)) return;
    const identityKey = itemIdentity(order);
    const item = items.get(identityKey) || {
      itemName,
      identityKey,
      vendor: order?.item_vendor || order?.vendor || '',
      variantKey: order?.item_variant_key || '',
      quantity: 0
    };
    item.quantity += quantity;
    items.set(identityKey, item);
  });

  return Array.from(items.values());
};
