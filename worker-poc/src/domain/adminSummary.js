import { ACTIONS, assertCan } from '../auth/permissions.js';
import { appendAuditEvent } from '../db/audit.js';
import { publicUser } from '../db/users.js';
import { badRequest } from '../http/errors.js';
import { isDateOnly } from './deadlines.js';

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

const memberRows = async (database) => {
  const result = await database.prepare(`
    SELECT user_id, employee_id, line_user_id, display_name, pickup_floor,
           balance, role, active, verification_status, created_at, updated_at
    FROM users
    ORDER BY display_name ASC, user_id ASC
  `).all();
  return rowsFrom(result).map((row) => publicUser({
    userId: row.user_id,
    employeeId: row.employee_id,
    lineUserId: row.line_user_id,
    displayName: row.display_name,
    pickupFloor: row.pickup_floor,
    balance: Number(row.balance),
    role: row.role,
    active: Boolean(row.active),
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
  const result = await database.prepare(`
    SELECT o.order_id, o.order_date, o.pickup_floor, o.note, o.created_at,
           u.display_name,
           oi.legacy_item_id, oi.item_name_snapshot, oi.quantity,
           oi.unit_price, oi.subtotal
    FROM orders o
    JOIN users u ON u.user_id = o.user_id
    JOIN order_items oi ON oi.order_id = o.order_id
    WHERE o.order_date = ? AND o.status = 'ACTIVE'
    ORDER BY o.pickup_floor ASC, o.order_id ASC, oi.line_no ASC
  `).bind(targetDate).all();
  const todayOrders = rowsFrom(result).map((row) => ({
    order_id: row.order_id,
    name: row.display_name,
    pickup_floor: row.pickup_floor,
    item_id: row.legacy_item_id || '',
    item_name: row.item_name_snapshot,
    quantity: Number(row.quantity),
    unit_price: Number(row.unit_price),
    subtotal: Number(row.subtotal),
    created_at: row.created_at,
    note: row.note || ''
  }));
  const itemMap = new Map();
  const pickupSummary = {};
  let totalItems = 0;
  let totalAmount = 0;
  for (const order of todayOrders) {
    const key = order.item_id || order.item_name;
    const item = itemMap.get(key) || {
      item_id: order.item_id,
      item_name: order.item_name,
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

export const getMemberBalances = async (database, identity, now = new Date()) => {
  assertCan(identity, ACTIONS.READ_MEMBER_BALANCES);
  await appendAuditEvent(database, {
    actorUserId: identity.authorizationActor.userId,
    actorAuthMode: identity.authorizationActor.authMode,
    actorEmployeeIdSnapshot: identity.authorizationActor.employeeId,
    actorLineUserIdSnapshot: identity.authorizationActor.lineUserId,
    targetUserId: identity.viewAs?.targetUserId || null,
    targetEmployeeIdSnapshot: identity.viewAs ? identity.effectiveSubject.employeeId : null,
    targetLineUserIdSnapshot: identity.viewAs ? identity.effectiveSubject.lineUserId : null,
    action: identity.viewAs ? 'VIEW_AS_MEMBER_BALANCES_READ' : 'MEMBER_BALANCES_READ',
    metadata: {},
    occurredAt: now.toISOString()
  });
  const members = await memberRows(database);
  return {
    success: true,
    requesterRole: identity.authorizationActor.role,
    members,
    users: members
  };
};
