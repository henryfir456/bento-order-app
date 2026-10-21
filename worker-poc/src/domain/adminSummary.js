import { ACTIONS, assertCan } from '../auth/permissions.js';
import { appendAuditEvent } from '../db/audit.js';
import { currentBalanceProjection, publicUser } from '../db/users.js';
import { badRequest, forbidden } from '../http/errors.js';
import { isDateOnly } from './deadlines.js';
import { isHistoricalOrderDate, orderStatusPredicate } from './ordersRead.js';
import { createEffectiveOrderItemNameResolver } from './effectiveOrderItemNames.js';

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

const memberRows = async (database, { includeInvalid = false } = {}) => {
  const result = await database.prepare(`
    SELECT u.user_id, u.employee_id, u.line_user_id, u.display_name, u.pickup_floor,
           ${currentBalanceProjection('u')} AS balance,
           CASE WHEN EXISTS (
             SELECT 1
             FROM protected_account_user_mappings mapping
             WHERE mapping.user_id = u.user_id
           ) THEN 1 ELSE 0 END AS is_protected_account,
           CASE WHEN u.role = 'User' AND vp.user_id IS NOT NULL
             THEN 'Vendor' ELSE u.role END AS role,
           CASE WHEN vp.user_id IS NULL THEN 0 ELSE 1 END AS vendor_principal,
           CASE WHEN u.role = 'User' AND vp.status = 'ACTIVE' AND EXISTS (
             SELECT 1
             FROM vendor_memberships vm
             JOIN vendors v ON v.vendor_id = vm.vendor_id
             WHERE vm.user_id = u.user_id
               AND vm.status = 'ACTIVE'
               AND v.enabled = 1
           ) THEN 1 ELSE 0 END AS vendor_access_active,
           u.active, u.invalid_reason, u.verification_status, u.created_at, u.updated_at
    FROM users u
    LEFT JOIN vendor_principals vp ON vp.user_id = u.user_id
    WHERE (? = 1 OR (u.active = 1 AND u.invalid_reason IS NULL))
    ORDER BY u.display_name ASC, u.user_id ASC
  `).bind(includeInvalid ? 1 : 0).all();
  return rowsFrom(result).map((row) => publicUser({
    userId: row.user_id,
    employeeId: row.employee_id,
    lineUserId: row.line_user_id,
    displayName: row.display_name,
    pickupFloor: row.pickup_floor,
    balance: Number(row.balance),
    isProtectedAccount: Boolean(row.is_protected_account),
    role: row.role,
    canonicalRole: row.role,
    vendorPrincipal: Number(row.vendor_principal || 0) === 1,
    vendorAccessActive: Number(row.vendor_access_active || 0) === 1,
    active: Boolean(row.active),
    invalidReason: row.invalid_reason,
    verificationStatus: row.verification_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
};

export const getAdminSummary = async (
  database,
  identity,
  targetDate,
  { includeMemberBalances = false, now = new Date() } = {}
) => {
  assertCan(identity, ACTIONS.READ_ADMIN_SUMMARY);
  if (!isDateOnly(targetDate)) throw badRequest('INVALID_DATE');
  const includeCompleted = isHistoricalOrderDate(targetDate, now);
  const result = await database.prepare(`
    SELECT o.order_id, o.order_date, o.vendor, o.pickup_floor, o.note, o.created_at,
           o.status,
           u.display_name,
           oi.line_no, oi.menu_item_id, oi.legacy_item_id, oi.item_name_snapshot, oi.quantity,
           oi.unit_price, oi.subtotal
    FROM orders o
    JOIN users u ON u.user_id = o.user_id
    JOIN order_items oi ON oi.order_id = o.order_id
    WHERE o.order_date = ?
      AND ${orderStatusPredicate({ alias: 'o', includeCompleted })}
    ORDER BY o.pickup_floor ASC, o.order_id ASC, oi.line_no ASC
  `).bind(targetDate).all();
  const resolveName = createEffectiveOrderItemNameResolver(database);
  const todayOrders = [];
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
    todayOrders.push({
      order_id: row.order_id,
      name: row.display_name,
      vendor: row.vendor,
      pickup_floor: row.pickup_floor,
      item_id: row.legacy_item_id || '',
      item_name: row.item_name_snapshot,
      display_item_name: effectiveItem.itemName,
      item_identity_key: effectiveItem.identityKey,
      item_vendor: effectiveItem.vendor,
      item_variant_key: effectiveItem.variantKey,
      item_code: effectiveItem.itemCode,
      item_name_resolved: effectiveItem.resolved,
      item_name_resolution_status: effectiveItem.resolutionStatus,
      quantity: Number(row.quantity),
      unit_price: Number(row.unit_price),
      subtotal: Number(row.subtotal),
      status: row.status,
      readOnly: row.status === 'COMPLETED',
      created_at: row.created_at,
      note: row.note || ''
    });
  }
  const itemMap = new Map();
  const pickupSummary = {};
  let totalItems = 0;
  let totalAmount = 0;
  for (const order of todayOrders) {
    const key = order.item_identity_key;
    const item = itemMap.get(key) || {
      item_id: order.item_id,
      item_identity_key: key,
      item_name: order.item_name,
      display_item_name: order.display_item_name,
      item_vendor: order.item_vendor,
      item_variant_key: order.item_variant_key,
      item_code: order.item_code,
      item_name_resolved: order.item_name_resolved,
      item_name_resolution_status: order.item_name_resolution_status,
      quantity: 0,
      totalAmount: 0
    };
    item.quantity += order.quantity;
    item.totalAmount += order.subtotal;
    itemMap.set(key, item);
    totalItems += order.quantity;
    totalAmount += order.subtotal;
    const floor = order.pickup_floor || '其他';
    pickupSummary[floor] ||= { totalItems: 0, totalAmount: 0 };
    pickupSummary[floor].totalItems += order.quantity;
    pickupSummary[floor].totalAmount += order.subtotal;
  }

  const canReadMembers = identity.actor.capabilities?.includes(ACTIONS.READ_MEMBER_BALANCES)
    && (includeMemberBalances || Boolean(identity.viewAs));
  if (canReadMembers || identity.viewAs) {
    await appendAuditEvent(database, {
      actorUserId: identity.authorizationActor.userId,
      actorAuthMode: identity.authorizationActor.authMode,
      actorEmployeeIdSnapshot: identity.authorizationActor.employeeId,
      actorLineUserIdSnapshot: identity.authorizationActor.lineUserId,
      targetUserId: identity.effectiveSubject.userId,
      targetEmployeeIdSnapshot: identity.effectiveSubject.employeeId,
      targetLineUserIdSnapshot: identity.effectiveSubject.lineUserId,
      action: identity.viewAs ? 'VIEW_AS_ADMIN_SUMMARY' : 'ADMIN_SUMMARY_READ',
      metadata: { targetDate, includeMemberBalances: canReadMembers },
      occurredAt: now.toISOString()
    });
  }
  return {
    success: true,
    targetDate,
    requesterRole: identity.authorizationActor.role,
    usersSummary: canReadMembers ? await memberRows(database) : [],
    todayOrders,
    totalItems,
    totalAmount,
    items: [...itemMap.values()],
    pickupSummary
  };
};

export const getMemberBalances = async (
  database,
  identity,
  now = new Date(),
  { includeInvalid = false } = {}
) => {
  assertCan(identity, ACTIONS.READ_MEMBER_BALANCES);
  if (includeInvalid && (identity.viewAs
    || identity.authorizationActor?.authMode !== 'line'
    || identity.authorizationActor?.role !== 'Admin'
    || identity.authorizationActor?.active !== true
    || identity.authorizationActor?.userId !== identity.actor?.userId)) {
    throw forbidden('ADMIN_LINE_AUTH_REQUIRED');
  }
  await appendAuditEvent(database, {
    actorUserId: identity.authorizationActor.userId,
    actorAuthMode: identity.authorizationActor.authMode,
    actorEmployeeIdSnapshot: identity.authorizationActor.employeeId,
    actorLineUserIdSnapshot: identity.authorizationActor.lineUserId,
    targetUserId: identity.viewAs?.targetUserId || null,
    targetEmployeeIdSnapshot: identity.viewAs ? identity.effectiveSubject.employeeId : null,
    targetLineUserIdSnapshot: identity.viewAs ? identity.effectiveSubject.lineUserId : null,
    action: identity.viewAs ? 'VIEW_AS_MEMBER_BALANCES_READ' : 'MEMBER_BALANCES_READ',
    metadata: { includeInvalid },
    occurredAt: now.toISOString()
  });
  const members = await memberRows(database, { includeInvalid });
  return {
    success: true,
    requesterRole: identity.authorizationActor.role,
    includeInvalid,
    members,
    users: members
  };
};
