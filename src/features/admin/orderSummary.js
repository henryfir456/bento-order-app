import { dishLabel } from '../../dishLabel.js';

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

const itemIdentity = (order, index = 0) => order?.item_identity_key
  || JSON.stringify(['unverified-order-line', order?.order_id || '', order?.line_no ?? '', index]);

const itemDisplayName = (order) => order?.display_item_name || order?.item_name;
const itemLabelKey = (order) => JSON.stringify([
  itemDisplayName(order) || '',
  order?.item_vendor || order?.vendor || '',
  order?.item_variant_key || ''
]);

export const duplicateItemLabelKeys = (orders = []) => {
  const identitiesByLabel = new Map();
  (Array.isArray(orders) ? orders : []).forEach((order, index) => {
    const key = itemLabelKey(order);
    if (!identitiesByLabel.has(key)) identitiesByLabel.set(key, new Set());
    identitiesByLabel.get(key).add(itemIdentity(order, index));
  });
  return new Set([...identitiesByLabel]
    .filter(([, identities]) => identities.size > 1)
    .map(([key]) => key));
};

export const formatOrderItemLabel = ({ itemName, vendor, variantKey } = {}) => (
  `${dishLabel({ name: itemName || '未命名品項', variantKey })}${vendor ? ` · ${vendor}` : ''}`
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
    const duplicateLabels = duplicateItemLabelKeys(floorOrders);
    floorOrders.forEach((order, index) => {
      const itemName = String(itemDisplayName(order) || '未命名品項').trim() || '未命名品項';
      const quantity = Number(order?.quantity || 0);
      if (!Number.isFinite(quantity)) return;
      const identityKey = itemIdentity(order, index);
      const item = items.get(identityKey) || {
        itemName,
        identityKey,
        vendor: order?.item_vendor || order?.vendor || '',
        variantKey: order?.item_variant_key || '',
        itemCode: order?.item_code || '',
        showIdentityCode: duplicateLabels.has(itemLabelKey(order)),
        resolved: order?.item_name_resolved !== false,
        resolutionStatus: order?.item_name_resolution_status || 'resolved',
        quantity: 0
      };
      item.quantity += quantity;
      item.resolved &&= order?.item_name_resolved !== false;
      if (order?.item_name_resolved === false) {
        item.resolutionStatus = order?.item_name_resolution_status || item.resolutionStatus;
      }
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
  const duplicateLabels = duplicateItemLabelKeys(orders);
  (Array.isArray(orders) ? orders : []).forEach((order, index) => {
    const itemName = String(itemDisplayName(order) || '未命名品項').trim() || '未命名品項';
    const quantity = Number(order?.quantity || 0);
    if (!Number.isFinite(quantity)) return;
    const identityKey = itemIdentity(order, index);
    const item = items.get(identityKey) || {
      itemName,
      identityKey,
      vendor: order?.item_vendor || order?.vendor || '',
      variantKey: order?.item_variant_key || '',
      itemCode: order?.item_code || '',
      showIdentityCode: duplicateLabels.has(itemLabelKey(order)),
      resolved: order?.item_name_resolved !== false,
      resolutionStatus: order?.item_name_resolution_status || 'resolved',
      quantity: 0
    };
    item.quantity += quantity;
    item.resolved &&= order?.item_name_resolved !== false;
    if (order?.item_name_resolved === false) {
      item.resolutionStatus = order?.item_name_resolution_status || item.resolutionStatus;
    }
    items.set(identityKey, item);
  });

  return Array.from(items.values());
};
