import { ACTIONS, assertCan } from '../auth/permissions.js';
import { requireIdentity } from '../http/authMiddleware.js';
import { auditStatement } from '../db/audit.js';
import { prepareStatement, randomId, resolveClock, runMutationBatch } from '../db/transactions.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import { jsonResponse } from '../http/response.js';
import { createEffectiveOrderItemNameResolver } from '../domain/effectiveOrderItemNames.js';
import { compatibilityVendorCandidates } from '../domain/menuVendors.js';
import { deadlineAt, isDateOnly } from '../domain/deadlines.js';
import { getActiveVendorIdsForPrincipal } from '../domain/vendorMemberships.js';

const text = (value) => String(value ?? '').trim();
const VERIFIED_VENDOR_ATTRIBUTION = 'CANONICAL_VENDOR_ATTRIBUTION_V1';
const rowsFrom = (result) => (Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : []));
const safeInteger = (value) => Number.isSafeInteger(Number(value)) ? Number(value) : null;
const validMonth = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(text(value));
const monthBounds = (month) => {
  if (!validMonth(month) || !isDateOnly(`${text(month)}-01`)) throw badRequest('MONTH_INVALID');
  const [year, monthNumber] = month.split('-').map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
  return { start: `${month}-01`, end: next };
};
const cleanReason = (value, code = 'REASON_REQUIRED') => {
  const reason = text(value);
  if (!reason || reason.length > 500) throw badRequest(code);
  return reason;
};
const pathSegment = (value) => {
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { throw badRequest('RESOURCE_ID_INVALID'); }
  const normalized = text(decoded);
  if (!normalized || normalized.length > 200) throw badRequest('RESOURCE_ID_INVALID');
  return normalized;
};

const activeVendorForId = async (database, vendorId) => database.prepare(`
  SELECT vendor_id, name FROM vendors WHERE vendor_id = ? AND enabled = 1 LIMIT 1
`).bind(vendorId).first();

const vendorForAdminRead = async (database, vendorId) => database.prepare(`
  SELECT vendor_id, name FROM vendors WHERE vendor_id = ? LIMIT 1
`).bind(vendorId).first();

const assertVendorActor = (identity, action) => {
  assertCan(identity, action);
  if (identity?.actor?.role !== 'Vendor'
    || identity?.actor?.userId !== identity?.authorizationActor?.userId
    || identity?.actor?.userId !== identity?.effectiveSubject?.userId) {
    throw forbidden('VENDOR_SCOPE_FORBIDDEN');
  }
};

const requireVendorIdentity = async (request, env, { fetchImpl, now }, action) => {
  const identity = await requireIdentity(request, env, { fetchImpl, allowViewAs: false, now });
  assertVendorActor(identity, action);
  const vendorIds = await getActiveVendorIdsForPrincipal(env.DB, identity.actor.userId);
  if (!vendorIds.length) throw forbidden('VENDOR_SCOPE_FORBIDDEN');
  return { identity, vendorIds };
};

const activeOrderRows = async (database, vendorId, serviceDate) => {
  const result = await database.prepare(`
    SELECT o.order_id, o.order_date, o.vendor,
      oi.line_no, oi.menu_item_id, oi.legacy_item_id, oi.item_name_snapshot,
      oi.quantity, oi.unit_price, oi.subtotal
    FROM orders o
    JOIN vendor_order_vendor_attributions attribution ON attribution.order_id = o.order_id
    JOIN order_items oi ON oi.order_id = o.order_id
    WHERE attribution.vendor_id = ? AND o.order_date = ? AND o.status = 'ACTIVE'
    ORDER BY o.order_id, oi.line_no
  `).bind(vendorId, serviceDate).all();
  return rowsFrom(result);
};

const aggregateDay = async (database, vendor, serviceDate, resolveName) => {
  const rows = await activeOrderRows(database, vendor.vendor_id, serviceDate);
  const items = new Map();
  for (const row of rows) {
    const resolved = await resolveName({ vendor: vendor.name, orderDate: serviceDate, item: row });
    const key = JSON.stringify([resolved.identityKey, resolved.variantKey]);
    const item = items.get(key) || {
      name: resolved.itemName,
      variantKey: resolved.variantKey || '',
      quantity: 0,
      amountTwd: 0
    };
    item.quantity += Number(row.quantity);
    item.amountTwd += Number(row.subtotal);
    items.set(key, item);
  }
  const values = [...items.values()].sort((a, b) => (
    a.name.localeCompare(b.name, 'zh-Hant') || a.variantKey.localeCompare(b.variantKey)
  ));
  return {
    orderCount: new Set(rows.map((row) => row.order_id)).size,
    portionCount: values.reduce((sum, item) => sum + item.quantity, 0),
    amountTwd: values.reduce((sum, item) => sum + item.amountTwd, 0),
    items: values
  };
};

const calendarMode = async (database, vendorName, serviceDate) => {
  const vendorNames = compatibilityVendorCandidates(vendorName);
  const placeholders = vendorNames.map(() => '?').join(', ');
  const row = await database.prepare(`
    SELECT mode FROM calendar_settings
    WHERE order_date = ? AND vendor IN (${placeholders})
    ORDER BY CASE WHEN vendor = ? THEN 0 ELSE 1 END LIMIT 1
  `).bind(serviceDate, ...vendorNames, vendorNames[0]).first();
  return row?.mode === 'B' ? 'B' : row?.mode === 'A' ? 'A' : null;
};

const adjustmentReasonAfter = async (database, vendorId, serviceDate, snapshotAt) => {
  const result = await database.prepare(`
    SELECT h.reason FROM order_status_history h
    JOIN orders o ON o.order_id = h.order_id
    JOIN vendor_order_vendor_attributions attribution ON attribution.order_id = o.order_id
    WHERE attribution.vendor_id = ? AND o.order_date = ? AND h.occurred_at > ?
    ORDER BY h.occurred_at DESC, h.transition_id DESC LIMIT 20
  `).bind(vendorId, serviceDate, snapshotAt).all();
  const reasons = new Set(rowsFrom(result).map((row) => row.reason));
  if (reasons.has('ORDER_CANCELLED')) return 'ORDER_CANCELLATION_REFUND';
  if (reasons.has('ORDER_REPLACED')) return 'ORDER_REPLACEMENT_OR_PRICE_CHANGE';
  return 'ORDER_ACTIVITY_CHANGE';
};

const readLatestSnapshot = async (database, vendorId, serviceDate) => database.prepare(`
  SELECT snapshot_id, revision, snapshot_kind, order_count, portion_count,
    amount_twd, items_json, change_reason, created_at
  FROM vendor_day_snapshots
  WHERE vendor_id = ? AND service_date = ? AND attribution_basis = ?
  ORDER BY revision DESC LIMIT 1
`).bind(vendorId, serviceDate, VERIFIED_VENDOR_ATTRIBUTION).first();

const appendSnapshotIfNeeded = async (database, identity, vendor, serviceDate, aggregate, now) => {
  const existing = await readLatestSnapshot(database, vendor.vendor_id, serviceDate);
  if (existing
    && Number(existing.order_count) === aggregate.orderCount
    && Number(existing.portion_count) === aggregate.portionCount
    && Number(existing.amount_twd) === aggregate.amountTwd
    && existing.items_json === JSON.stringify(aggregate.items)) return existing;

  const highestRevision = await database.prepare(`
    SELECT MAX(revision) AS revision FROM vendor_day_snapshots
    WHERE vendor_id = ? AND service_date = ?
  `).bind(vendor.vendor_id, serviceDate).first();
  const revision = Number(highestRevision?.revision || 0) + 1;
  const snapshotId = randomId('vendor_snapshot');
  const reason = existing
    ? await adjustmentReasonAfter(database, vendor.vendor_id, serviceDate, existing.created_at)
    : 'AFTER_CUTOFF_BASELINE';
  const createdAt = now.toISOString();
  const snapshot = prepareStatement(database, `
    INSERT OR IGNORE INTO vendor_day_snapshots (
      snapshot_id, vendor_id, service_date, revision, snapshot_kind,
      order_count, portion_count, amount_twd, items_json, change_reason,
      created_by_user_id, created_at, attribution_basis
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    snapshotId, vendor.vendor_id, serviceDate, revision,
    existing ? 'ADJUSTMENT' : 'BASELINE',
    aggregate.orderCount, aggregate.portionCount, aggregate.amountTwd,
    JSON.stringify(aggregate.items), reason, identity.actor.userId, createdAt,
    VERIFIED_VENDOR_ATTRIBUTION
  ]);
  const audit = auditStatement(database, {
    actorUserId: identity.actor.userId,
    actorAuthMode: identity.actor.authMode,
    action: existing ? 'VENDOR_DAY_SNAPSHOT_ADJUSTED' : 'VENDOR_DAY_SNAPSHOT_CREATED',
    metadata: { vendorId: vendor.vendor_id, serviceDate, revision, reason },
    occurredAt: createdAt,
    onlyIfPriorMutation: true
  });
  await runMutationBatch(database, [snapshot, audit]);
  return readLatestSnapshot(database, vendor.vendor_id, serviceDate);
};

const latestPaymentEventQuery = `
  SELECT e.event_type FROM vendor_payment_events e
  WHERE e.payment_id = p.payment_id
  ORDER BY e.event_sequence DESC LIMIT 1
`;

const paymentRowsForDay = async (database, vendorId, serviceDate) => {
  const result = await database.prepare(`
    SELECT p.payment_id, p.amount_twd AS payment_amount_twd, p.transferred_on,
      a.allocation_id,
      a.amount_twd + COALESCE((
        SELECT SUM(e.delta_twd) FROM vendor_transfer_allocation_events e
        WHERE e.allocation_id = a.allocation_id
      ), 0) AS allocated_twd,
      COALESCE((${latestPaymentEventQuery}), 'REGISTERED') AS payment_status,
      (SELECT MIN(primary_allocation.service_date)
        FROM vendor_transfer_allocations primary_allocation
        WHERE primary_allocation.payment_id = p.payment_id
          AND primary_allocation.attribution_basis = '${VERIFIED_VENDOR_ATTRIBUTION}') AS primary_service_date,
      COALESCE((SELECT e.reason FROM vendor_payment_events e
        WHERE e.payment_id = p.payment_id AND e.event_type = 'DISPUTED'
        ORDER BY e.event_sequence DESC LIMIT 1), '') AS dispute_reason,
      COALESCE((SELECT e.resolution FROM vendor_payment_events e
        WHERE e.payment_id = p.payment_id AND e.event_type = 'RESOLVED'
        ORDER BY e.event_sequence DESC LIMIT 1), '') AS resolution,
      COALESCE((SELECT e.reason FROM vendor_payment_events e
        WHERE e.payment_id = p.payment_id AND e.event_type = 'REVERSED'
        ORDER BY e.event_sequence DESC LIMIT 1), '') AS reversal_reason,
      CASE WHEN COALESCE((${latestPaymentEventQuery}), 'REGISTERED') = 'REVERSED' THEN 0
        ELSE p.amount_twd - COALESCE((
        SELECT SUM(allocation.amount_twd + COALESCE((
          SELECT SUM(event.delta_twd) FROM vendor_transfer_allocation_events event
          WHERE event.allocation_id = allocation.allocation_id
        ), 0))
        FROM vendor_transfer_allocations allocation
        WHERE allocation.payment_id = p.payment_id
          AND allocation.attribution_basis = '${VERIFIED_VENDOR_ATTRIBUTION}'
      ), 0) END AS unallocated_twd
    FROM vendor_transfer_payments p
    JOIN vendor_transfer_allocations a ON a.payment_id = p.payment_id
    WHERE a.vendor_id = ? AND a.service_date = ?
      AND a.attribution_basis = ?
      AND NOT EXISTS (
        SELECT 1 FROM vendor_transfer_allocations unverified
        WHERE unverified.payment_id = p.payment_id
          AND unverified.attribution_basis IS NOT '${VERIFIED_VENDOR_ATTRIBUTION}'
      )
    ORDER BY p.transferred_on DESC, p.created_at DESC, p.payment_id
  `).bind(vendorId, serviceDate, VERIFIED_VENDOR_ATTRIBUTION).all();
  return rowsFrom(result).map((row) => ({
    paymentId: row.payment_id,
    allocationId: row.allocation_id,
    isPrimaryTransferRow: row.primary_service_date === serviceDate,
    paymentAmountTwd: Number(row.payment_amount_twd),
    unallocatedAmountTwd: Number(row.unallocated_twd),
    transferredOn: row.transferred_on,
    allocatedAmountTwd: Number(row.allocated_twd),
    status: row.payment_status,
    disputeReason: row.dispute_reason || null,
    resolution: row.resolution || null,
    reversalReason: row.reversal_reason || null
  }));
};

const settlementForDay = async (database, vendorId, serviceDate, receivableTwd) => {
  const transfers = await paymentRowsForDay(database, vendorId, serviceDate);
  const registeredTransferTwd = transfers.reduce((sum, entry) => sum + entry.allocatedAmountTwd, 0);
  return {
    receivableTwd,
    registeredTransferTwd,
    unregisteredDifferenceTwd: Math.max(0, receivableTwd - registeredTransferTwd),
    overAllocatedTwd: Math.max(0, registeredTransferTwd - receivableTwd),
    pendingConfirmationTwd: transfers
      .filter((entry) => entry.status === 'REGISTERED')
      .reduce((sum, entry) => sum + entry.allocatedAmountTwd, 0),
    confirmedTwd: transfers
      .filter((entry) => ['ACKNOWLEDGED', 'RESOLVED'].includes(entry.status))
      .reduce((sum, entry) => sum + entry.allocatedAmountTwd, 0),
    disputedTwd: transfers
      .filter((entry) => entry.status === 'DISPUTED')
      .reduce((sum, entry) => sum + entry.allocatedAmountTwd, 0),
    transfers
  };
};

const datesForMonth = async (database, vendor, bounds) => {
  const result = await database.prepare(`
    SELECT service_date FROM (
      SELECT o.order_date AS service_date
      FROM vendor_order_vendor_attributions attribution
      JOIN orders o ON o.order_id = attribution.order_id
      WHERE attribution.vendor_id = ? AND o.order_date >= ? AND o.order_date < ?
      UNION SELECT service_date FROM vendor_day_snapshots
      WHERE vendor_id = ? AND service_date >= ? AND service_date < ?
        AND attribution_basis = '${VERIFIED_VENDOR_ATTRIBUTION}'
      UNION SELECT service_date FROM vendor_transfer_allocations
      WHERE vendor_id = ? AND service_date >= ? AND service_date < ?
        AND attribution_basis = '${VERIFIED_VENDOR_ATTRIBUTION}'
    ) ORDER BY service_date DESC
  `).bind(vendor.vendor_id, bounds.start, bounds.end,
    vendor.vendor_id, bounds.start, bounds.end,
    vendor.vendor_id, bounds.start, bounds.end).all();
  return rowsFrom(result).map((row) => String(row.service_date));
};

const buildDay = async (database, identity, vendor, serviceDate, now, resolveName) => {
  const mode = await calendarMode(database, vendor.name, serviceDate);
  const cutoff = mode ? deadlineAt(serviceDate, mode) : null;
  const cutoffPassed = Boolean(cutoff && now.getTime() > cutoff.getTime());
  const current = await aggregateDay(database, vendor, serviceDate, resolveName);
  let displayed = current;
  let revision = 0;
  let changeReason = null;
  if (cutoffPassed) {
    const snapshot = await appendSnapshotIfNeeded(database, identity, vendor, serviceDate, current, now);
    displayed = {
      orderCount: Number(snapshot.order_count),
      portionCount: Number(snapshot.portion_count),
      amountTwd: Number(snapshot.amount_twd),
      items: JSON.parse(snapshot.items_json)
    };
    revision = Number(snapshot.revision);
    changeReason = snapshot.change_reason;
  }
  return {
    serviceDate,
    vendorId: vendor.vendor_id,
    vendorName: vendor.name,
    cutoffAt: cutoff?.toISOString() || null,
    cutoffPassed,
    source: cutoffPassed ? 'SNAPSHOT' : 'ESTIMATE',
    revision,
    changeReason,
    orderCount: displayed.orderCount,
    portionCount: displayed.portionCount,
    amountTwd: displayed.amountTwd,
    items: displayed.items,
    settlement: await settlementForDay(database, vendor.vendor_id, serviceDate, displayed.amountTwd)
  };
};

const operationsForVendor = async (database, identity, vendor, month, now) => {
  const bounds = monthBounds(month);
  const dates = await datesForMonth(database, vendor, bounds);
  const resolveName = createEffectiveOrderItemNameResolver(database);
  const days = [];
  for (const serviceDate of dates) {
    days.push(await buildDay(database, identity, vendor, serviceDate, now, resolveName));
  }
  return { success: true, month, vendor: { id: vendor.vendor_id, name: vendor.name }, days };
};

const adminIdentity = async (request, env, { fetchImpl, now }) => {
  const identity = await requireIdentity(request, env, { fetchImpl, allowViewAs: false, now });
  assertCan(identity, ACTIONS.ADMIN_VENDOR_SETTLEMENTS);
  if (identity.actor.role !== 'Admin' || identity.actor.authMode !== 'line') {
    throw forbidden('ADMIN_LINE_AUTH_REQUIRED');
  }
  return identity;
};

const parseJson = async (request) => {
  if (!request.body) throw badRequest('INVALID_JSON');
  try {
    const value = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
    return value;
  } catch {
    throw badRequest('INVALID_JSON');
  }
};

const normalizeAllocations = (value) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 31) {
    throw badRequest('ALLOCATIONS_REQUIRED');
  }
  const seen = new Set();
  return value.map((entry) => {
    const serviceDate = text(entry?.serviceDate);
    const amountTwd = safeInteger(entry?.amountTwd);
    if (!isDateOnly(serviceDate) || amountTwd === null || amountTwd <= 0) {
      throw badRequest('ALLOCATION_INVALID');
    }
    if (seen.has(serviceDate)) throw badRequest('ALLOCATION_DATE_DUPLICATE');
    seen.add(serviceDate);
    return { serviceDate, amountTwd };
  }).sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));
};

const paymentById = async (database, paymentId) => database.prepare(`
  SELECT payment_id, vendor_id, amount_twd, transferred_on FROM vendor_transfer_payments
  WHERE payment_id = ? LIMIT 1
`).bind(paymentId).first();

const vendorPaymentById = async (database, paymentId) => database.prepare(`
  SELECT p.payment_id, p.vendor_id, p.amount_twd, p.transferred_on
  FROM vendor_transfer_payments p
  WHERE p.payment_id = ?
    AND EXISTS (
      SELECT 1 FROM vendor_transfer_allocations a
      WHERE a.payment_id = p.payment_id
        AND a.attribution_basis = ?
    )
    AND NOT EXISTS (
      SELECT 1 FROM vendor_transfer_allocations a
      WHERE a.payment_id = p.payment_id
        AND a.attribution_basis IS NOT ?
    )
  LIMIT 1
`).bind(paymentId, VERIFIED_VENDOR_ATTRIBUTION, VERIFIED_VENDOR_ATTRIBUTION).first();

const currentPaymentStatus = async (database, paymentId) => {
  const row = await database.prepare(`
    SELECT event_type FROM vendor_payment_events
    WHERE payment_id = ? ORDER BY event_sequence DESC LIMIT 1
  `).bind(paymentId).first();
  return row?.event_type || 'REGISTERED';
};

const postAdminTransfer = async (database, identity, body, now) => {
  const vendorId = text(body.vendorId);
  const vendor = await activeVendorForId(database, vendorId);
  if (!vendor) throw notFound('VENDOR_NOT_FOUND');
  const amountTwd = safeInteger(body.amountTwd);
  if (amountTwd === null || amountTwd <= 0) throw badRequest('PAYMENT_AMOUNT_INVALID');
  const transferredOn = text(body.transferredOn);
  if (!isDateOnly(transferredOn)) throw badRequest('TRANSFER_DATE_INVALID');
  const idempotencyKey = text(body.idempotencyKey);
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(idempotencyKey)) throw badRequest('IDEMPOTENCY_KEY_INVALID');
  const allocations = normalizeAllocations(body.allocations);
  const allocationTotal = allocations.reduce((sum, entry) => sum + entry.amountTwd, 0);
  if (!Number.isSafeInteger(allocationTotal) || allocationTotal > amountTwd) {
    throw badRequest('ALLOCATIONS_EXCEED_PAYMENT');
  }
  if (body.actualTransferDone !== true || body.detailsReviewed !== true) {
    throw badRequest('PAYMENT_CONFIRMATION_REQUIRED');
  }
  const canonicalPayload = JSON.stringify({ vendorId, amountTwd, transferredOn, allocations });
  const existing = await database.prepare(`
    SELECT payment_id, request_hash FROM vendor_transfer_payments
    WHERE created_by_user_id = ? AND idempotency_key = ? LIMIT 1
  `).bind(identity.actor.userId, idempotencyKey).first();
  if (existing) {
    if (existing.request_hash !== canonicalPayload) throw conflict('IDEMPOTENCY_KEY_REUSED');
    return { success: true, paymentId: existing.payment_id, replayed: true };
  }

  const paymentId = randomId('vendor_payment');
  const createdAt = now.toISOString();
  const statements = [prepareStatement(database, `
    INSERT INTO vendor_transfer_payments (
      payment_id, vendor_id, amount_twd, transferred_on, idempotency_key,
      request_hash, created_by_user_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [paymentId, vendor.vendor_id, amountTwd, transferredOn, idempotencyKey,
    canonicalPayload, identity.actor.userId, createdAt])];
  for (const allocation of allocations) {
    statements.push(prepareStatement(database, `
      INSERT INTO vendor_transfer_allocations (
        allocation_id, payment_id, vendor_id, service_date, amount_twd,
        created_by_user_id, created_at, attribution_basis
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [randomId('vendor_allocation'), paymentId, vendor.vendor_id,
      allocation.serviceDate, allocation.amountTwd, identity.actor.userId, createdAt,
      VERIFIED_VENDOR_ATTRIBUTION]));
  }
  statements.push(auditStatement(database, {
    actorUserId: identity.actor.userId,
    actorAuthMode: identity.actor.authMode,
    action: 'VENDOR_BANK_TRANSFER_RECORDED',
    metadata: {
      paymentId,
      vendorId: vendor.vendor_id,
      amountTwd,
      transferredOn,
      allocations
    },
    occurredAt: createdAt
  }));
  try {
    await runMutationBatch(database, statements);
  } catch (error) {
    const cause = error?.cause?.message || '';
    if (cause.includes('VENDOR_DAY_RECEIVABLE_EXCEEDED')) throw conflict('VENDOR_DAY_RECEIVABLE_EXCEEDED');
    if (cause.includes('VENDOR_PAYMENT_ALLOCATION_INVALID')) throw conflict('VENDOR_PAYMENT_ALLOCATION_INVALID');
    if (cause.includes('UNIQUE constraint failed')) {
      const concurrent = await database.prepare(`
        SELECT payment_id, request_hash FROM vendor_transfer_payments
        WHERE created_by_user_id = ? AND idempotency_key = ? LIMIT 1
      `).bind(identity.actor.userId, idempotencyKey).first();
      if (concurrent?.request_hash === canonicalPayload) {
        return { success: true, paymentId: concurrent.payment_id, replayed: true };
      }
      throw conflict('IDEMPOTENCY_KEY_REUSED');
    }
    throw error;
  }
  return { success: true, paymentId, replayed: false };
};

const postVendorPaymentEvent = async (database, identity, vendorIds, paymentId, eventType, reason, now) => {
  const payment = await vendorPaymentById(database, paymentId);
  if (!payment || !vendorIds.includes(String(payment.vendor_id))) throw notFound('PAYMENT_NOT_FOUND');
  const currentStatus = await currentPaymentStatus(database, paymentId);
  if (currentStatus !== 'REGISTERED') throw conflict('PAYMENT_RESPONSE_ALREADY_RECORDED');
  const eventId = randomId('vendor_payment_event');
  const createdAt = now.toISOString();
  try {
    await runMutationBatch(database, [
      prepareStatement(database, `
        INSERT INTO vendor_payment_events (
          event_id, payment_id, event_type, reason, resolution, actor_user_id, created_at
        ) VALUES (?, ?, ?, ?, '', ?, ?)
      `, [eventId, paymentId, eventType, reason, identity.actor.userId, createdAt]),
      auditStatement(database, {
        actorUserId: identity.actor.userId,
        actorAuthMode: identity.actor.authMode,
        action: eventType === 'ACKNOWLEDGED'
          ? 'VENDOR_PAYMENT_ACKNOWLEDGED'
          : 'VENDOR_PAYMENT_DISPUTED',
        metadata: { paymentId, eventId, ...(eventType === 'DISPUTED' ? { reason } : {}) },
        occurredAt: createdAt
      })
    ]);
  } catch (error) {
    const cause = error?.cause?.message || '';
    if (cause.includes('UNIQUE constraint failed') || cause.includes('VENDOR_PAYMENT_EVENT_STATE_INVALID')) {
      const latestStatus = await currentPaymentStatus(database, paymentId);
      if (cause.includes('VENDOR_PAYMENT_EVENT_STATE_INVALID') && latestStatus === 'REVERSED') {
        throw conflict('PAYMENT_ALREADY_REVERSED');
      }
      if (latestStatus !== 'REGISTERED') throw conflict('PAYMENT_RESPONSE_ALREADY_RECORDED');
    }
    throw error;
  }
  return { success: true, paymentId, status: eventType };
};

const postAdminResolution = async (database, identity, paymentId, body, now) => {
  const payment = await paymentById(database, paymentId);
  if (!payment) throw notFound('PAYMENT_NOT_FOUND');
  if (await currentPaymentStatus(database, paymentId) !== 'DISPUTED') {
    throw conflict('PAYMENT_NOT_DISPUTED');
  }
  const resolution = cleanReason(body.resolution, 'RESOLUTION_REQUIRED');
  const eventId = randomId('vendor_payment_event');
  const createdAt = now.toISOString();
  try {
    await runMutationBatch(database, [
      prepareStatement(database, `
        INSERT INTO vendor_payment_events (
          event_id, payment_id, event_type, reason, resolution, actor_user_id, created_at
        ) VALUES (?, ?, 'RESOLVED', '', ?, ?, ?)
      `, [eventId, paymentId, resolution, identity.actor.userId, createdAt]),
      auditStatement(database, {
        actorUserId: identity.actor.userId,
        actorAuthMode: identity.actor.authMode,
        action: 'VENDOR_PAYMENT_DISPUTE_RESOLVED',
        metadata: { paymentId, eventId },
        occurredAt: createdAt
      })
    ]);
  } catch (error) {
    const cause = error?.cause?.message || '';
    if (cause.includes('UNIQUE constraint failed') || cause.includes('VENDOR_PAYMENT_EVENT_STATE_INVALID')) {
      const latestStatus = await currentPaymentStatus(database, paymentId);
      if (latestStatus === 'RESOLVED') throw conflict('PAYMENT_DISPUTE_ALREADY_RESOLVED');
      if (cause.includes('VENDOR_PAYMENT_EVENT_STATE_INVALID') && latestStatus === 'REVERSED') {
        throw conflict('PAYMENT_ALREADY_REVERSED');
      }
    }
    throw error;
  }
  return { success: true, paymentId, status: 'RESOLVED' };
};

const postAdminPaymentReversal = async (database, identity, paymentId, body, now) => {
  const payment = await paymentById(database, paymentId);
  if (!payment) throw notFound('PAYMENT_NOT_FOUND');
  const status = await currentPaymentStatus(database, paymentId);
  if (status === 'REVERSED') throw conflict('PAYMENT_ALREADY_REVERSED');
  if (status === 'DISPUTED') throw conflict('PAYMENT_DISPUTE_MUST_BE_RESOLVED');
  if (body.confirmed !== true) throw badRequest('PAYMENT_REVERSAL_CONFIRMATION_REQUIRED');
  const reason = cleanReason(body.reason, 'REVERSAL_REASON_REQUIRED');
  const allocations = rowsFrom(await database.prepare(`
    SELECT a.allocation_id,
      a.amount_twd + COALESCE((
        SELECT SUM(e.delta_twd) FROM vendor_transfer_allocation_events e
        WHERE e.allocation_id = a.allocation_id
      ), 0) AS current_amount_twd
    FROM vendor_transfer_allocations a
    WHERE a.payment_id = ?
    ORDER BY a.service_date, a.allocation_id
  `).bind(paymentId).all());
  const createdAt = now.toISOString();
  const statements = [];
  for (const allocation of allocations) {
    const amount = safeInteger(allocation.current_amount_twd);
    if (amount === null || amount < 0) throw conflict('VENDOR_ALLOCATION_ADJUSTMENT_INVALID');
    if (amount === 0) continue;
    const eventId = randomId('vendor_allocation_event');
    statements.push(prepareStatement(database, `
      INSERT INTO vendor_transfer_allocation_events (
        event_id, allocation_id, delta_twd, reason, actor_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `, [eventId, allocation.allocation_id, -amount, reason, identity.actor.userId, createdAt]));
    statements.push(auditStatement(database, {
      actorUserId: identity.actor.userId,
      actorAuthMode: identity.actor.authMode,
      action: 'VENDOR_TRANSFER_ALLOCATION_ADJUSTED',
      metadata: {
        allocationId: allocation.allocation_id,
        paymentId,
        deltaTwd: -amount,
        reason,
        eventId,
        reversal: true
      },
      occurredAt: createdAt
    }));
  }
  const eventId = randomId('vendor_payment_event');
  statements.push(prepareStatement(database, `
    INSERT INTO vendor_payment_events (
      event_id, payment_id, event_type, reason, resolution, actor_user_id, created_at
    ) VALUES (?, ?, 'REVERSED', ?, '', ?, ?)
  `, [eventId, paymentId, reason, identity.actor.userId, createdAt]));
  statements.push(auditStatement(database, {
    actorUserId: identity.actor.userId,
    actorAuthMode: identity.actor.authMode,
    action: 'VENDOR_BANK_TRANSFER_REVERSED',
    metadata: {
      paymentId,
      eventId,
      vendorId: payment.vendor_id,
      amountTwd: Number(payment.amount_twd),
      transferredOn: payment.transferred_on,
      reason,
      allocationCount: allocations.length
    },
    occurredAt: createdAt
  }));
  try {
    await runMutationBatch(database, statements);
  } catch (error) {
    const cause = error?.cause?.message || '';
    if (cause.includes('UNIQUE constraint failed')
      && await currentPaymentStatus(database, paymentId) === 'REVERSED') {
      throw conflict('PAYMENT_ALREADY_REVERSED');
    }
    if (cause.includes('VENDOR_PAYMENT_EVENT_STATE_INVALID')) {
      const latestStatus = await currentPaymentStatus(database, paymentId);
      if (latestStatus === 'REVERSED') throw conflict('PAYMENT_ALREADY_REVERSED');
      if (latestStatus === 'DISPUTED') throw conflict('PAYMENT_DISPUTE_MUST_BE_RESOLVED');
      throw conflict('PAYMENT_REVERSAL_CONFLICT');
    }
    if (cause.includes('VENDOR_ALLOCATION_ADJUSTMENT_INVALID')) {
      throw conflict('VENDOR_ALLOCATION_ADJUSTMENT_INVALID');
    }
    throw error;
  }
  return { success: true, paymentId, status: 'REVERSED', eventId };
};

const postAdminAllocationAdjustment = async (database, identity, allocationId, body, now) => {
  const row = await database.prepare(`
    SELECT allocation_id, vendor_id, service_date FROM vendor_transfer_allocations
    WHERE allocation_id = ? LIMIT 1
  `).bind(allocationId).first();
  if (!row) throw notFound('ALLOCATION_NOT_FOUND');
  const deltaTwd = safeInteger(body.deltaTwd);
  if (deltaTwd === null || deltaTwd === 0) throw badRequest('ALLOCATION_ADJUSTMENT_INVALID');
  const reason = cleanReason(body.reason);
  const eventId = randomId('vendor_allocation_event');
  const createdAt = now.toISOString();
  try {
    await runMutationBatch(database, [
      prepareStatement(database, `
        INSERT INTO vendor_transfer_allocation_events (
          event_id, allocation_id, delta_twd, reason, actor_user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [eventId, allocationId, deltaTwd, reason, identity.actor.userId, createdAt]),
      auditStatement(database, {
        actorUserId: identity.actor.userId,
        actorAuthMode: identity.actor.authMode,
        action: 'VENDOR_TRANSFER_ALLOCATION_ADJUSTED',
        metadata: { allocationId, vendorId: row.vendor_id, serviceDate: row.service_date, deltaTwd, eventId },
        occurredAt: createdAt
      })
    ]);
  } catch (error) {
    if ((error?.cause?.message || '').includes('VENDOR_ALLOCATION_ADJUSTMENT_INVALID')) {
      throw conflict('VENDOR_ALLOCATION_ADJUSTMENT_INVALID');
    }
    throw error;
  }
  return { success: true, allocationId, deltaTwd, eventId };
};

export const handleVendorOperationsRoute = async (request, env, {
  fetchImpl = globalThis.fetch,
  now: suppliedNow = new Date()
} = {}) => {
  const url = new URL(request.url);
  const now = resolveClock(suppliedNow);
  const vendorRead = request.method === 'GET' && url.pathname === '/api/vendor/orders';
  const adminRead = request.method === 'GET' && url.pathname === '/api/admin/vendor-operations';
  const adminCreate = request.method === 'POST' && url.pathname === '/api/admin/vendor-payments';
  const vendorAck = request.method === 'POST'
    && /^\/api\/vendor\/payments\/[^/]+\/acknowledgement$/.test(url.pathname);
  const vendorDispute = request.method === 'POST'
    && /^\/api\/vendor\/payments\/[^/]+\/disputes$/.test(url.pathname);
  const adminResolve = request.method === 'POST'
    && /^\/api\/admin\/vendor-payments\/[^/]+\/dispute-resolution$/.test(url.pathname);
  const adminReverse = request.method === 'POST'
    && /^\/api\/admin\/vendor-payments\/[^/]+\/reversals$/.test(url.pathname);
  const adminAdjust = request.method === 'POST'
    && /^\/api\/admin\/vendor-payment-allocations\/[^/]+\/adjustments$/.test(url.pathname);
  if (!vendorRead && !adminRead && !adminCreate && !vendorAck && !vendorDispute
    && !adminResolve && !adminReverse && !adminAdjust) return null;

  if (vendorRead) {
    if ([...url.searchParams.keys()].some((key) => key !== 'month')) throw forbidden('VENDOR_SCOPE_FORBIDDEN');
    const { identity, vendorIds } = await requireVendorIdentity(request, env, { fetchImpl, now }, ACTIONS.VENDOR_READ_OPERATIONS);
    const month = text(url.searchParams.get('month'));
    const results = [];
    for (const vendorId of vendorIds) {
      const vendor = await activeVendorForId(env.DB, vendorId);
      if (vendor) results.push(await operationsForVendor(env.DB, identity, vendor, month, now));
    }
    return jsonResponse({ success: true, month, vendors: results.map(({ vendor }) => vendor),
      days: results.flatMap(({ days }) => days) });
  }

  if (adminRead) {
    const identity = await adminIdentity(request, env, { fetchImpl, now });
    const month = text(url.searchParams.get('month'));
    const vendorId = text(url.searchParams.get('vendorId'));
    if (!vendorId) throw badRequest('VENDOR_ID_REQUIRED');
    if ([...url.searchParams.keys()].some((key) => !['month', 'vendorId'].includes(key))) {
      throw badRequest('QUERY_PARAMETER_UNSUPPORTED');
    }
    const vendor = await vendorForAdminRead(env.DB, vendorId);
    if (!vendor) throw notFound('VENDOR_NOT_FOUND');
    return jsonResponse(await operationsForVendor(env.DB, identity, vendor, month, now));
  }

  if (adminCreate) {
    const identity = await adminIdentity(request, env, { fetchImpl, now });
    const result = await postAdminTransfer(env.DB, identity, await parseJson(request), now);
    return jsonResponse(result, result.replayed ? 200 : 201);
  }

  if (vendorAck || vendorDispute) {
    const match = url.pathname.match(/^\/api\/vendor\/payments\/([^/]+)\/(?:acknowledgement|disputes)$/);
    const paymentId = pathSegment(match?.[1] || '');
    const { identity, vendorIds } = await requireVendorIdentity(request, env, { fetchImpl, now },
      vendorAck ? ACTIONS.VENDOR_CONFIRM_TRANSFER : ACTIONS.VENDOR_DISPUTE_TRANSFER);
    const body = vendorDispute ? await parseJson(request) : {};
    const reason = vendorDispute ? cleanReason(body.reason, 'DISPUTE_REASON_REQUIRED') : '';
    return jsonResponse(await postVendorPaymentEvent(env.DB, identity, vendorIds, paymentId,
      vendorAck ? 'ACKNOWLEDGED' : 'DISPUTED', reason, now));
  }

  if (adminResolve) {
    const identity = await adminIdentity(request, env, { fetchImpl, now });
    const paymentId = pathSegment(url.pathname.match(/^\/api\/admin\/vendor-payments\/([^/]+)\/dispute-resolution$/)?.[1] || '');
    return jsonResponse(await postAdminResolution(env.DB, identity, paymentId, await parseJson(request), now));
  }

  if (adminReverse) {
    const identity = await adminIdentity(request, env, { fetchImpl, now });
    const paymentId = pathSegment(url.pathname.match(/^\/api\/admin\/vendor-payments\/([^/]+)\/reversals$/)?.[1] || '');
    return jsonResponse(await postAdminPaymentReversal(env.DB, identity, paymentId, await parseJson(request), now));
  }

  const identity = await adminIdentity(request, env, { fetchImpl, now });
  const allocationId = pathSegment(url.pathname.match(/^\/api\/admin\/vendor-payment-allocations\/([^/]+)\/adjustments$/)?.[1] || '');
  return jsonResponse(await postAdminAllocationAdjustment(env.DB, identity, allocationId, await parseJson(request), now));
};
