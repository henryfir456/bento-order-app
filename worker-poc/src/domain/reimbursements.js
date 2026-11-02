import { ACTIONS, assertCan } from '../auth/permissions.js';
import { auditStatement } from '../db/audit.js';
import { ledgerMutationStatements } from '../db/ledgerQueries.js';
import { prepareStatement, randomId, resolveClock, runMutationBatch } from '../db/transactions.js';
import { getUserById } from '../db/users.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import { getTaipeiDate } from './deadlines.js';
import { notificationStatement } from './userNotifications.js';

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NOTE_LIMIT = 500;
const LIST_LIMIT = 100;
const STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED']);

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const validDate = (value) => {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const requireProxyAdmin = (identity) => {
  assertCan(identity, ACTIONS.REQUEST_REIMBURSEMENT);
  if (identity?.actor?.role !== 'ProxyAdmin') throw forbidden('REIMBURSEMENT_REQUESTER_ONLY');
  return identity.actor;
};

const publicRequest = (row) => ({
  requestId: row.request_id,
  requesterUserId: row.requester_user_id,
  requesterName: row.requester_name || null,
  orderDate: row.order_date,
  amount: Number(row.amount),
  orderCount: Number(row.order_count),
  status: row.status,
  requesterNote: row.requester_note || '',
  reviewNote: row.review_note || '',
  reviewedAt: row.reviewed_at || null,
  createdAt: row.created_at
});

// Orders the actor placed for somebody else on `orderDate` that still count.
const DELEGATED_ORDERS_SQL = `
  FROM orders o
  WHERE o.created_by_user_id = ?
    AND o.user_id <> o.created_by_user_id
    AND o.order_date = ?
    AND o.status IN ('ACTIVE', 'COMPLETED')
`;

const delegatedOrders = async (database, userId, orderDate) => {
  const result = await database.prepare(`
    SELECT o.order_id, o.display_name_snapshot AS name, o.vendor, o.total_amount
    ${DELEGATED_ORDERS_SQL}
    ORDER BY o.created_at, o.order_id
  `).bind(userId, orderDate).all();
  return rowsFrom(result).map((row) => ({
    orderId: row.order_id,
    name: row.name,
    vendor: row.vendor,
    amount: Number(row.total_amount)
  }));
};

const openRequestFor = (database, userId, orderDate) => database.prepare(`
  SELECT request_id, status FROM reimbursement_requests
  WHERE requester_user_id = ? AND order_date = ? AND status IN ('PENDING', 'APPROVED')
  LIMIT 1
`).bind(userId, orderDate).first();

const parseDate = (value, today) => {
  const orderDate = text(value);
  if (!validDate(orderDate)) throw badRequest('REIMBURSEMENT_DATE_INVALID');
  if (orderDate > today) throw badRequest('REIMBURSEMENT_DATE_IN_FUTURE');
  return orderDate;
};

export const previewReimbursement = async (database, identity, dateInput, now = new Date()) => {
  const actor = requireProxyAdmin(identity);
  const orderDate = parseDate(dateInput, getTaipeiDate(resolveClock(now)));
  const orders = await delegatedOrders(database, actor.userId, orderDate);
  const open = await openRequestFor(database, actor.userId, orderDate);
  return {
    success: true,
    orderDate,
    orders,
    orderCount: orders.length,
    amount: orders.reduce((sum, order) => sum + order.amount, 0),
    existingRequest: open ? { requestId: open.request_id, status: open.status } : null
  };
};

export const listMyReimbursements = async (database, identity) => {
  const actor = requireProxyAdmin(identity);
  const result = await database.prepare(`
    SELECT * FROM reimbursement_requests
    WHERE requester_user_id = ?
    ORDER BY created_at DESC, request_id DESC
    LIMIT ${LIST_LIMIT}
  `).bind(actor.userId).all();
  return { success: true, requests: rowsFrom(result).map(publicRequest) };
};

export const createReimbursement = async (database, identity, input, now = new Date()) => {
  const actor = requireProxyAdmin(identity);
  const occurredAt = resolveClock(now).toISOString();
  const orderDate = parseDate(input?.orderDate, getTaipeiDate(resolveClock(now)));
  const note = text(input?.note);
  if (note.length > NOTE_LIMIT) throw badRequest('REIMBURSEMENT_NOTE_TOO_LONG');

  const preview = await previewReimbursement(database, identity, orderDate, now);
  if (preview.existingRequest) throw conflict('REIMBURSEMENT_ALREADY_REQUESTED');
  if (!preview.orderCount || preview.amount <= 0) throw conflict('REIMBURSEMENT_NO_ELIGIBLE_ORDERS');

  const requestId = randomId('reimb');
  // The amount is recomputed inside the INSERT so a concurrent order change
  // cannot make the stored amount disagree with what the DB sees.
  const insert = prepareStatement(database, `
    INSERT INTO reimbursement_requests (
      request_id, requester_user_id, order_date, amount, order_count, status,
      requester_note, created_at, updated_at
    )
    SELECT ?, ?, ?, SUM(o.total_amount), COUNT(*), 'PENDING', ?, ?, ?
    ${DELEGATED_ORDERS_SQL}
    HAVING SUM(o.total_amount) > 0
  `, [requestId, actor.userId, orderDate, note, occurredAt, occurredAt, actor.userId, orderDate]);
  const admins = rowsFrom(await database.prepare(`
    SELECT user_id FROM users WHERE role = 'Admin' AND active = 1
  `).all());
  const requestedHere = {
    sql: 'EXISTS (SELECT 1 FROM reimbursement_requests WHERE request_id = ?)',
    params: [requestId]
  };
  const notifications = admins.map((admin) => notificationStatement(database, {
    userId: admin.user_id,
    kind: 'REIMBURSEMENT_REQUESTED',
    title: '代理管理員請款申請',
    body: `${actor.displayName || '代理管理員'} 申請 ${orderDate} 的代訂款項 $${preview.amount}，請至管理頁審核。`,
    refDate: orderDate,
    dedupeKey: `reimb-requested:${requestId}:${admin.user_id}`,
    occurredAt,
    guard: requestedHere
  }));
  try {
    await runMutationBatch(database, [insert, ...notifications]);
  } catch (error) {
    if (error?.code === 'TRANSACTION_FAILED') throw conflict('REIMBURSEMENT_ALREADY_REQUESTED');
    throw error;
  }
  const row = await database.prepare('SELECT * FROM reimbursement_requests WHERE request_id = ?')
    .bind(requestId).first();
  if (!row) throw conflict('REIMBURSEMENT_NO_ELIGIBLE_ORDERS');
  return { success: true, message: 'REIMBURSEMENT_REQUESTED', request: publicRequest(row) };
};

export const listAdminReimbursements = async (database, identity, statusInput) => {
  assertCan(identity, ACTIONS.ADMIN_REIMBURSEMENT);
  const status = text(statusInput).toUpperCase();
  if (status && !STATUSES.has(status)) throw badRequest('REIMBURSEMENT_STATUS_INVALID');
  const result = await database.prepare(`
    SELECT r.*, u.display_name AS requester_name
    FROM reimbursement_requests r
    JOIN users u ON u.user_id = r.requester_user_id
    ${status ? 'WHERE r.status = ?' : ''}
    ORDER BY CASE r.status WHEN 'PENDING' THEN 0 ELSE 1 END, r.created_at DESC, r.request_id DESC
    LIMIT ${LIST_LIMIT}
  `).bind(...(status ? [status] : [])).all();
  const requests = rowsFrom(result).map(publicRequest);
  // Show each pending request's order detail so the Admin can cross-check.
  for (const request of requests) {
    if (request.status === 'PENDING') {
      request.orders = await delegatedOrders(database, request.requesterUserId, request.orderDate);
    }
  }
  return { success: true, requests };
};

const loadRequest = async (database, requestId) => {
  const row = await database.prepare('SELECT * FROM reimbursement_requests WHERE request_id = ?')
    .bind(requestId).first();
  if (!row) throw notFound('REIMBURSEMENT_NOT_FOUND');
  return row;
};

const settledError = (row) => conflict(
  row.status === 'APPROVED' ? 'REIMBURSEMENT_ALREADY_APPROVED' : 'REIMBURSEMENT_ALREADY_REJECTED'
);

export const approveReimbursement = async (database, identity, requestId, now = new Date()) => {
  assertCan(identity, ACTIONS.ADMIN_REIMBURSEMENT);
  const actor = identity.actor;
  const row = await loadRequest(database, requestId);
  if (row.status !== 'PENDING') throw settledError(row);
  const requester = await getUserById(database, row.requester_user_id);
  if (!requester || requester.vendorPrincipal) throw conflict('REIMBURSEMENT_REQUESTER_INVALID');

  const occurredAt = resolveClock(now).toISOString();
  const transactionId = randomId('txn');
  const auditId = randomId('audit');
  const amount = Number(row.amount);

  // Statement 1 flips PENDING -> APPROVED and stamps this attempt's unique
  // transaction id. Only the attempt that flipped the row passes the guard,
  // so a double click or retry can never credit twice.
  const flip = prepareStatement(database, `
    UPDATE reimbursement_requests
    SET status = 'APPROVED', reviewed_by_user_id = ?, reviewed_at = ?,
        ledger_transaction_id = ?, updated_at = ?
    WHERE request_id = ? AND status = 'PENDING'
  `, [actor.userId, occurredAt, transactionId, occurredAt, requestId]);
  const audit = auditStatement(database, {
    auditId,
    actorUserId: actor.userId,
    actorAuthMode: actor.authMode,
    actorEmployeeIdSnapshot: actor.employeeId,
    actorLineUserIdSnapshot: actor.lineUserId,
    targetUserId: requester.userId,
    targetEmployeeIdSnapshot: requester.employeeId,
    targetLineUserIdSnapshot: requester.lineUserId,
    action: 'BALANCE_TOP_UP',
    metadata: {
      source: 'REIMBURSEMENT',
      requestId,
      orderDate: row.order_date,
      amount,
      transactionId
    },
    occurredAt,
    onlyIfPriorMutation: true
  });
  const guard = {
    sql: `EXISTS (
      SELECT 1 FROM reimbursement_requests
      WHERE request_id = ? AND status = 'APPROVED' AND ledger_transaction_id = ?
    )`,
    params: [requestId, transactionId]
  };
  const ledger = ledgerMutationStatements(database, {
    transactionId,
    userId: requester.userId,
    employeeIdSnapshot: requester.employeeId,
    lineUserIdSnapshot: requester.lineUserId,
    displayNameSnapshot: requester.displayName,
    amount,
    balanceAfter: 0,
    type: 'TOPUP',
    referenceId: auditId,
    operatorUserId: actor.userId,
    operatorEmployeeIdSnapshot: actor.employeeId,
    operatorLineUserIdSnapshot: actor.lineUserId,
    operatorDisplayNameSnapshot: actor.displayName,
    operatorAuthMode: actor.authMode,
    authMode: actor.authMode,
    note: `代訂請款 ${row.order_date}`,
    occurredAt
  }, { guard, dynamicBalanceAfter: true });
  const notify = notificationStatement(database, {
    userId: requester.userId,
    kind: 'REIMBURSEMENT_REVIEWED',
    title: '請款已核准',
    body: `${row.order_date} 的代訂款項 $${amount} 已核准並加入你的餘額。`,
    refDate: row.order_date,
    dedupeKey: `reimb-reviewed:${requestId}`,
    occurredAt,
    guard
  });
  try {
    await runMutationBatch(database, [flip, audit, ...ledger.statements, notify]);
  } catch (error) {
    if (error?.code === 'TRANSACTION_FAILED') throw conflict('MUTATION_CONFLICT');
    throw error;
  }
  const after = await loadRequest(database, requestId);
  if (after.status !== 'APPROVED' || after.ledger_transaction_id !== transactionId) {
    throw settledError(after);
  }
  return {
    success: true,
    message: 'REIMBURSEMENT_APPROVED',
    transactionId,
    request: publicRequest(after)
  };
};

export const rejectReimbursement = async (database, identity, requestId, input, now = new Date()) => {
  assertCan(identity, ACTIONS.ADMIN_REIMBURSEMENT);
  const actor = identity.actor;
  const reviewNote = text(input?.note);
  if (reviewNote.length > NOTE_LIMIT) throw badRequest('REIMBURSEMENT_NOTE_TOO_LONG');
  const row = await loadRequest(database, requestId);
  if (row.status !== 'PENDING') throw settledError(row);

  const occurredAt = resolveClock(now).toISOString();
  const flip = prepareStatement(database, `
    UPDATE reimbursement_requests
    SET status = 'REJECTED', reviewed_by_user_id = ?, reviewed_at = ?,
        review_note = ?, updated_at = ?
    WHERE request_id = ? AND status = 'PENDING'
  `, [actor.userId, occurredAt, reviewNote, occurredAt, requestId]);
  const audit = auditStatement(database, {
    actorUserId: actor.userId,
    actorAuthMode: actor.authMode,
    actorEmployeeIdSnapshot: actor.employeeId,
    actorLineUserIdSnapshot: actor.lineUserId,
    targetUserId: row.requester_user_id,
    action: 'REIMBURSEMENT_REJECTED',
    metadata: { requestId, orderDate: row.order_date, amount: Number(row.amount), reviewNote },
    occurredAt,
    onlyIfPriorMutation: true
  });
  const notify = notificationStatement(database, {
    userId: row.requester_user_id,
    kind: 'REIMBURSEMENT_REVIEWED',
    title: '請款未核准',
    body: `${row.order_date} 的代訂請款未核准${reviewNote ? `：${reviewNote}` : '。'}`,
    refDate: row.order_date,
    dedupeKey: `reimb-reviewed:${requestId}`,
    occurredAt,
    guard: {
      sql: "EXISTS (SELECT 1 FROM reimbursement_requests WHERE request_id = ? AND status = 'REJECTED' AND reviewed_at = ?)",
      params: [requestId, occurredAt]
    }
  });
  await runMutationBatch(database, [flip, audit, notify]);
  const after = await loadRequest(database, requestId);
  if (after.status !== 'REJECTED') throw settledError(after);
  return { success: true, message: 'REIMBURSEMENT_REJECTED', request: publicRequest(after) };
};
