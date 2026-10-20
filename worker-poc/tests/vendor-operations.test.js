import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  handleFormalRequest,
  profileFetch,
  request,
  seedUser,
  seedVendor
} from './helpers/formal-fixtures.js';
import { SqliteD1 } from './helpers/formal-db.js';

const fixedNow = new Date('2026-10-20T00:00:00.000Z');

const addVendorPrincipal = (database, { userId, vendorId }) => {
  database.run(`
    INSERT INTO vendor_principals (user_id, principal_role, status)
    VALUES (?, 'Vendor', 'ACTIVE')
  `, userId);
  database.run(`
    INSERT INTO vendor_memberships (user_id, vendor_id, status)
    VALUES (?, ?, 'ACTIVE')
  `, userId, vendorId);
};

const addOrder = (database, {
  orderId,
  buyerId,
  serviceDate,
  vendor,
  status = 'ACTIVE',
  itemName,
  quantity,
  unitPrice
}) => {
  const totalAmount = quantity * unitPrice;
  database.run(`
    INSERT INTO orders (
      order_id, user_id, display_name_snapshot, order_date, vendor,
      pickup_floor, total_amount, status, created_by_user_id,
      created_auth_mode, created_at, updated_at
    ) VALUES (?, ?, 'Synthetic Buyer Name', ?, ?, '1樓', ?, ?, ?, 'line', ?, ?)
  `, orderId, buyerId, serviceDate, vendor, totalAmount, status, buyerId,
  '2026-10-19T04:00:00.000Z', '2026-10-19T04:00:00.000Z');
  database.run(`
    INSERT INTO order_items (
      order_id, line_no, item_name_snapshot, quantity, unit_price, subtotal
    ) VALUES (?, 1, ?, ?, ?, ?)
  `, orderId, itemName, quantity, unitPrice, totalAmount);
};

const call = async (database, path, { method = 'GET', token, lineUserId, body, now = fixedNow } = {}) => {
  const response = await handleFormalRequest(
    request(path, { method, token, body }),
    { DB: database },
    {
      fetchImpl: profileFetch({ token, lineUserId, displayName: 'Synthetic Vendor Actor' }),
      now
    }
  );
  return { response, body: await response.json() };
};

test('Vendor daily orders aggregate historical prices by Taipei service date and stay within active memberships', async () => {
  const database = new SqliteD1();
  seedVendor(database, { vendorId: 'synthetic-vendor-a', name: 'Synthetic Bento A' });
  seedVendor(database, { vendorId: 'synthetic-vendor-b', name: 'Synthetic Bento B' });
  seedUser(database, {
    userId: 'synthetic-vendor-principal-a',
    lineUserId: 'synthetic-line-vendor-a',
    employeeId: null,
    displayName: 'Synthetic Vendor A'
  });
  addVendorPrincipal(database, {
    userId: 'synthetic-vendor-principal-a',
    vendorId: 'synthetic-vendor-a'
  });
  seedUser(database, {
    userId: 'synthetic-buyer-a',
    lineUserId: 'synthetic-line-buyer-a',
    employeeId: 'SYNTHETIC-BUYER-A',
    displayName: 'Synthetic Buyer A'
  });
  seedUser(database, {
    userId: 'synthetic-buyer-b',
    lineUserId: 'synthetic-line-buyer-b',
    employeeId: 'SYNTHETIC-BUYER-B',
    displayName: 'Synthetic Buyer B'
  });
  database.run(`
    INSERT INTO calendar_settings (order_date, vendor, mode)
    VALUES ('2026-10-20', 'Synthetic Bento A', 'A')
  `);
  addOrder(database, {
    orderId: 'synthetic-order-a1',
    buyerId: 'synthetic-buyer-a',
    serviceDate: '2026-10-20',
    vendor: 'Synthetic Bento A',
    itemName: 'Synthetic Rice Box',
    quantity: 2,
    unitPrice: 85
  });
  addOrder(database, {
    orderId: 'synthetic-order-a2-cancelled',
    buyerId: 'synthetic-buyer-b',
    serviceDate: '2026-10-20',
    vendor: 'Synthetic Bento A',
    status: 'CANCELLED',
    itemName: 'Synthetic Rice Box',
    quantity: 1,
    unitPrice: 85
  });
  addOrder(database, {
    orderId: 'synthetic-order-b1',
    buyerId: 'synthetic-buyer-b',
    serviceDate: '2026-10-20',
    vendor: 'Synthetic Bento B',
    itemName: 'Synthetic Noodle Box',
    quantity: 3,
    unitPrice: 70
  });

  const result = await call(database, '/api/vendor/orders?month=2026-10', {
    token: 'synthetic-vendor-token',
    lineUserId: 'synthetic-line-vendor-a'
  });

  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body.days, [{
    serviceDate: '2026-10-20',
    vendorId: 'synthetic-vendor-a',
    vendorName: 'Synthetic Bento A',
    cutoffAt: '2026-10-20T02:00:00.000Z',
    cutoffPassed: false,
    source: 'ESTIMATE',
    revision: 0,
    changeReason: null,
    orderCount: 1,
    portionCount: 2,
    amountTwd: 170,
    settlement: {
      receivableTwd: 170,
      registeredTransferTwd: 0,
      unregisteredDifferenceTwd: 170,
      overAllocatedTwd: 0,
      pendingConfirmationTwd: 0,
      confirmedTwd: 0,
      disputedTwd: 0,
      transfers: []
    },
    items: [{ name: 'Synthetic Rice Box', variantKey: '', quantity: 2, amountTwd: 170 }]
  }]);
  const serialized = JSON.stringify(result.body);
  assert.doesNotMatch(serialized, /Synthetic Buyer Name|SYNTHETIC-BUYER|synthetic-line-buyer|synthetic-order-b/);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM balance_ledger').count, 0);

  const forged = await call(database, '/api/vendor/orders?month=2026-10&vendorId=synthetic-vendor-b', {
    token: 'synthetic-vendor-token',
    lineUserId: 'synthetic-line-vendor-a'
  });
  assert.equal(forged.response.status, 403);
});

test('Admin can record one transfer across dates, replay idempotently, and Vendor can acknowledge without touching employee ledger', async () => {
  const database = new SqliteD1();
  seedVendor(database, { vendorId: 'synthetic-vendor-a', name: 'Synthetic Bento A' });
  seedUser(database, {
    userId: 'synthetic-vendor-principal-a', lineUserId: 'synthetic-line-vendor-a',
    employeeId: null, displayName: 'Synthetic Vendor A'
  });
  addVendorPrincipal(database, { userId: 'synthetic-vendor-principal-a', vendorId: 'synthetic-vendor-a' });
  seedUser(database, {
    userId: 'synthetic-admin', lineUserId: 'synthetic-line-admin', employeeId: 'SYNTHETIC-ADMIN',
    displayName: 'Synthetic Admin', role: 'Admin'
  });
  seedUser(database, {
    userId: 'synthetic-buyer', lineUserId: 'synthetic-line-buyer', employeeId: 'SYNTHETIC-BUYER',
    displayName: 'Synthetic Buyer'
  });
  for (const serviceDate of ['2026-10-20', '2026-10-21']) {
    database.run('INSERT INTO calendar_settings (order_date, vendor, mode) VALUES (?, ?, \'A\')', serviceDate, 'Synthetic Bento A');
    addOrder(database, {
      orderId: `synthetic-order-${serviceDate}`,
      buyerId: 'synthetic-buyer',
      serviceDate,
      vendor: 'Synthetic Bento A',
      itemName: 'Synthetic Rice Box',
      quantity: 2,
      unitPrice: 85
    });
  }
  const payload = {
    vendorId: 'synthetic-vendor-a',
    amountTwd: 300,
    transferredOn: '2026-10-20',
    actualTransferDone: true,
    detailsReviewed: true,
    idempotencyKey: 'synthetic-transfer-1001',
    allocations: [
      { serviceDate: '2026-10-20', amountTwd: 100 },
      { serviceDate: '2026-10-21', amountTwd: 120 }
    ]
  };
  const missingDetailsReview = await call(database, '/api/admin/vendor-payments', {
    method: 'POST', token: 'synthetic-admin-token', lineUserId: 'synthetic-line-admin',
    body: { ...payload, detailsReviewed: false, idempotencyKey: 'synthetic-unreviewed-transfer' }
  });
  assert.equal(missingDetailsReview.response.status, 400);
  assert.equal(missingDetailsReview.body.error, 'PAYMENT_CONFIRMATION_REQUIRED');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM vendor_transfer_payments').count, 0);
  const first = await call(database, '/api/admin/vendor-payments', {
    method: 'POST', token: 'synthetic-admin-token', lineUserId: 'synthetic-line-admin', body: payload
  });
  assert.equal(first.response.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.replayed, false);
  const replay = await call(database, '/api/admin/vendor-payments', {
    method: 'POST', token: 'synthetic-admin-token', lineUserId: 'synthetic-line-admin', body: payload
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.paymentId, first.body.paymentId);
  assert.equal(replay.body.replayed, true);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM vendor_transfer_payments').count, 1);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM vendor_transfer_allocations').count, 2);
  const overAllocation = await call(database, '/api/admin/vendor-payments', {
    method: 'POST', token: 'synthetic-admin-token', lineUserId: 'synthetic-line-admin',
    body: {
      vendorId: 'synthetic-vendor-a', amountTwd: 100, transferredOn: '2026-10-20',
      actualTransferDone: true, detailsReviewed: true,
      idempotencyKey: 'synthetic-over-allocation',
      allocations: [{ serviceDate: '2026-10-20', amountTwd: 80 }]
    }
  });
  assert.equal(overAllocation.response.status, 409);
  assert.equal(overAllocation.body.error, 'VENDOR_DAY_RECEIVABLE_EXCEEDED');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM vendor_transfer_payments').count, 1);

  const vendorRead = await call(database, '/api/vendor/orders?month=2026-10', {
    token: 'synthetic-vendor-token', lineUserId: 'synthetic-line-vendor-a'
  });
  const firstDay = vendorRead.body.days.find((day) => day.serviceDate === '2026-10-20');
  assert.equal(firstDay.settlement.registeredTransferTwd, 100);
  assert.equal(firstDay.settlement.unregisteredDifferenceTwd, 70);
  assert.equal(firstDay.settlement.pendingConfirmationTwd, 100);
  assert.equal(firstDay.settlement.transfers[0].paymentAmountTwd, 300);
  assert.equal(firstDay.settlement.transfers[0].allocatedAmountTwd, 100);
  assert.equal(firstDay.settlement.transfers[0].unallocatedAmountTwd, 80);
  assert.equal(firstDay.settlement.transfers[0].isPrimaryTransferRow, true);
  const secondDay = vendorRead.body.days.find((day) => day.serviceDate === '2026-10-21');
  assert.equal(secondDay.settlement.transfers[0].isPrimaryTransferRow, false);

  const acknowledged = await call(database, `/api/vendor/payments/${first.body.paymentId}/acknowledgement`, {
    method: 'POST', token: 'synthetic-vendor-token', lineUserId: 'synthetic-line-vendor-a'
  });
  assert.equal(acknowledged.response.status, 200, JSON.stringify(acknowledged.body));
  const confirmedRead = await call(database, '/api/vendor/orders?month=2026-10', {
    token: 'synthetic-vendor-token', lineUserId: 'synthetic-line-vendor-a'
  });
  const confirmedDay = confirmedRead.body.days.find((day) => day.serviceDate === '2026-10-20');
  assert.equal(confirmedDay.settlement.confirmedTwd, 100);
  assert.equal(confirmedDay.settlement.pendingConfirmationTwd, 0);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM balance_ledger').count, 0);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'VENDOR_BANK_TRANSFER_RECORDED'").count, 1);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'VENDOR_PAYMENT_ACKNOWLEDGED'").count, 1);
});

test('Vendor disputes require a reason, only their own vendor payment is visible, and Admin resolution is append-only', async () => {
  const database = new SqliteD1();
  seedVendor(database, { vendorId: 'synthetic-vendor-a', name: 'Synthetic Bento A' });
  seedVendor(database, { vendorId: 'synthetic-vendor-b', name: 'Synthetic Bento B' });
  seedUser(database, {
    userId: 'synthetic-vendor-principal-a', lineUserId: 'synthetic-line-vendor-a', employeeId: null
  });
  addVendorPrincipal(database, { userId: 'synthetic-vendor-principal-a', vendorId: 'synthetic-vendor-a' });
  seedUser(database, {
    userId: 'synthetic-admin', lineUserId: 'synthetic-line-admin', employeeId: 'SYNTHETIC-ADMIN', role: 'Admin'
  });
  seedUser(database, {
    userId: 'synthetic-proxy-admin', lineUserId: 'synthetic-line-proxy-admin',
    employeeId: 'SYNTHETIC-PROXY-ADMIN', role: 'ProxyAdmin'
  });
  seedUser(database, {
    userId: 'synthetic-buyer-a', lineUserId: 'synthetic-line-buyer-a', employeeId: 'SYNTHETIC-BUYER-A'
  });
  seedUser(database, {
    userId: 'synthetic-buyer-b', lineUserId: 'synthetic-line-buyer-b', employeeId: 'SYNTHETIC-BUYER-B'
  });
  for (const [date, vendorName, vendorId, buyerId] of [
    ['2026-10-20', 'Synthetic Bento A', 'synthetic-vendor-a', 'synthetic-buyer-a'],
    ['2026-10-21', 'Synthetic Bento B', 'synthetic-vendor-b', 'synthetic-buyer-b']
  ]) {
    database.run('INSERT INTO calendar_settings (order_date, vendor, mode) VALUES (?, ?, \'A\')', date, vendorName);
    addOrder(database, {
      orderId: `synthetic-order-${vendorId}`,
      buyerId,
      serviceDate: date,
      vendor: vendorName,
      itemName: 'Synthetic Rice Box',
      quantity: 1,
      unitPrice: 80
    });
  }
  const create = async (vendorId, date, key) => call(database, '/api/admin/vendor-payments', {
    method: 'POST', token: 'synthetic-admin-token', lineUserId: 'synthetic-line-admin',
    body: {
      vendorId, amountTwd: 80, transferredOn: date, idempotencyKey: key,
      actualTransferDone: true, detailsReviewed: true,
      allocations: [{ serviceDate: date, amountTwd: 80 }]
    }
  });
  const own = await create('synthetic-vendor-a', '2026-10-20', 'synthetic-payment-a');
  const other = await create('synthetic-vendor-b', '2026-10-21', 'synthetic-payment-b');
  const proxyRead = await call(database,
    '/api/admin/vendor-operations?month=2026-10&vendorId=synthetic-vendor-a', {
      token: 'synthetic-proxy-admin-token', lineUserId: 'synthetic-line-proxy-admin'
    });
  assert.equal(proxyRead.response.status, 403);
  const missingReason = await call(database, `/api/vendor/payments/${own.body.paymentId}/disputes`, {
    method: 'POST', token: 'synthetic-vendor-token', lineUserId: 'synthetic-line-vendor-a', body: { reason: '  ' }
  });
  assert.equal(missingReason.response.status, 400);
  const crossVendor = await call(database, `/api/vendor/payments/${other.body.paymentId}/disputes`, {
    method: 'POST', token: 'synthetic-vendor-token', lineUserId: 'synthetic-line-vendor-a', body: { reason: 'Synthetic mismatch' }
  });
  assert.equal(crossVendor.response.status, 404);
  const disputed = await call(database, `/api/vendor/payments/${own.body.paymentId}/disputes`, {
    method: 'POST', token: 'synthetic-vendor-token', lineUserId: 'synthetic-line-vendor-a', body: { reason: 'Synthetic amount mismatch' }
  });
  assert.equal(disputed.response.status, 200, JSON.stringify(disputed.body));
  const disputedReversal = await call(database, `/api/admin/vendor-payments/${own.body.paymentId}/reversals`, {
    method: 'POST', token: 'synthetic-admin-token', lineUserId: 'synthetic-line-admin',
    body: { reason: 'Synthetic bank reversal', confirmed: true }
  });
  assert.equal(disputedReversal.response.status, 409);
  assert.equal(disputedReversal.body.error, 'PAYMENT_DISPUTE_MUST_BE_RESOLVED');
  const resolution = await call(database, `/api/admin/vendor-payments/${own.body.paymentId}/dispute-resolution`, {
    method: 'POST', token: 'synthetic-admin-token', lineUserId: 'synthetic-line-admin', body: { resolution: 'Synthetic transfer matched bank record' }
  });
  assert.equal(resolution.response.status, 200, JSON.stringify(resolution.body));
  const resolutionEvent = database.get(`
    SELECT event_type, reason, resolution FROM vendor_payment_events
    WHERE payment_id = ? ORDER BY rowid DESC LIMIT 1
  `, own.body.paymentId);
  assert.equal(resolutionEvent.event_type, 'RESOLVED');
  assert.equal(resolutionEvent.reason, '');
  assert.equal(resolutionEvent.resolution, 'Synthetic transfer matched bank record');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM vendor_payment_events WHERE payment_id = ?', own.body.paymentId).count, 2);
});

test('Admin reversal appends atomic allocation and payment events, confirms twice, and leaves the employee ledger untouched', async () => {
  const database = new SqliteD1();
  seedVendor(database, { vendorId: 'synthetic-vendor-a', name: 'Synthetic Bento A' });
  seedUser(database, {
    userId: 'synthetic-admin', lineUserId: 'synthetic-line-admin', employeeId: 'SYNTHETIC-ADMIN',
    displayName: 'Synthetic Admin', role: 'Admin'
  });
  seedUser(database, {
    userId: 'synthetic-vendor-principal', lineUserId: 'synthetic-line-vendor', employeeId: null,
    displayName: 'Synthetic Vendor'
  });
  addVendorPrincipal(database, { userId: 'synthetic-vendor-principal', vendorId: 'synthetic-vendor-a' });
  seedUser(database, {
    userId: 'synthetic-buyer', lineUserId: 'synthetic-line-buyer', employeeId: 'SYNTHETIC-BUYER'
  });
  database.run('INSERT INTO calendar_settings (order_date, vendor, mode) VALUES (?, ?, \'A\')',
    '2026-10-20', 'Synthetic Bento A');
  addOrder(database, {
    orderId: 'synthetic-order-reversal', buyerId: 'synthetic-buyer', serviceDate: '2026-10-20',
    vendor: 'Synthetic Bento A', itemName: 'Synthetic Rice Box', quantity: 2, unitPrice: 80
  });
  const payment = await call(database, '/api/admin/vendor-payments', {
    method: 'POST', token: 'synthetic-admin-token', lineUserId: 'synthetic-line-admin',
    body: {
      vendorId: 'synthetic-vendor-a', amountTwd: 150, transferredOn: '2026-10-20',
      idempotencyKey: 'synthetic-reversal-payment', actualTransferDone: true, detailsReviewed: true,
      allocations: [{ serviceDate: '2026-10-20', amountTwd: 100 }]
    }
  });
  assert.equal(payment.response.status, 201, JSON.stringify(payment.body));
  const vendorAck = await call(database, `/api/vendor/payments/${payment.body.paymentId}/acknowledgement`, {
    method: 'POST', token: 'synthetic-vendor-token', lineUserId: 'synthetic-line-vendor'
  });
  assert.equal(vendorAck.response.status, 200);

  const unconfirmed = await call(database, `/api/admin/vendor-payments/${payment.body.paymentId}/reversals`, {
    method: 'POST', token: 'synthetic-admin-token', lineUserId: 'synthetic-line-admin',
    body: { reason: 'Synthetic bank returned the transfer', confirmed: false }
  });
  assert.equal(unconfirmed.response.status, 400);
  assert.equal(unconfirmed.body.error, 'PAYMENT_REVERSAL_CONFIRMATION_REQUIRED');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM vendor_payment_events WHERE payment_id = ?',
    payment.body.paymentId).count, 1);

  const reversed = await call(database, `/api/admin/vendor-payments/${payment.body.paymentId}/reversals`, {
    method: 'POST', token: 'synthetic-admin-token', lineUserId: 'synthetic-line-admin',
    body: { reason: 'Synthetic bank returned the transfer', confirmed: true }
  });
  assert.equal(reversed.response.status, 200, JSON.stringify(reversed.body));
  assert.equal(reversed.body.status, 'REVERSED');
  const replay = await call(database, `/api/admin/vendor-payments/${payment.body.paymentId}/reversals`, {
    method: 'POST', token: 'synthetic-admin-token', lineUserId: 'synthetic-line-admin',
    body: { reason: 'Synthetic duplicate request', confirmed: true }
  });
  assert.equal(replay.response.status, 409);
  assert.equal(replay.body.error, 'PAYMENT_ALREADY_REVERSED');

  const read = await call(database, '/api/vendor/orders?month=2026-10', {
    token: 'synthetic-vendor-token', lineUserId: 'synthetic-line-vendor'
  });
  const day = read.body.days[0];
  assert.equal(day.settlement.registeredTransferTwd, 0);
  assert.equal(day.settlement.confirmedTwd, 0);
  assert.equal(day.settlement.unregisteredDifferenceTwd, 160);
  assert.equal(day.settlement.transfers[0].status, 'REVERSED');
  assert.equal(day.settlement.transfers[0].allocatedAmountTwd, 0);
  assert.equal(day.settlement.transfers[0].unallocatedAmountTwd, 0);
  assert.equal(day.settlement.transfers[0].reversalReason, 'Synthetic bank returned the transfer');
  assert.equal(database.get('SELECT COUNT(*) AS count FROM vendor_transfer_payments').count, 1);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM vendor_transfer_allocation_events').count, 1);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM vendor_payment_events WHERE event_type = \'REVERSED\'').count, 1);
  assert.equal(database.get("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'VENDOR_BANK_TRANSFER_REVERSED'").count, 1);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM balance_ledger').count, 0);
  assert.throws(() => database.run('DELETE FROM vendor_payment_events'), /VENDOR_PAYMENT_EVENT_APPEND_ONLY/);
});

test('post-cutoff cancellation creates a traceable immutable revision and does not touch employee ledger', async () => {
  const database = new SqliteD1();
  seedVendor(database, { vendorId: 'synthetic-vendor-a', name: 'Synthetic Bento A' });
  seedUser(database, {
    userId: 'synthetic-vendor-principal-a', lineUserId: 'synthetic-line-vendor-a', employeeId: null
  });
  addVendorPrincipal(database, { userId: 'synthetic-vendor-principal-a', vendorId: 'synthetic-vendor-a' });
  seedUser(database, {
    userId: 'synthetic-buyer-a', lineUserId: 'synthetic-line-buyer-a', employeeId: 'SYNTHETIC-BUYER-A'
  });
  seedUser(database, {
    userId: 'synthetic-admin', lineUserId: 'synthetic-line-admin', employeeId: 'SYNTHETIC-ADMIN', role: 'Admin'
  });
  database.run('INSERT INTO calendar_settings (order_date, vendor, mode) VALUES (?, ?, \'A\')', '2026-10-20', 'Synthetic Bento A');
  addOrder(database, {
    orderId: 'synthetic-order-post-cutoff', buyerId: 'synthetic-buyer-a', serviceDate: '2026-10-20',
    vendor: 'Synthetic Bento A', itemName: 'Synthetic Rice Box', quantity: 2, unitPrice: 85
  });
  const afterCutoff = new Date('2026-10-20T03:00:00.000Z');
  const first = await call(database, '/api/vendor/orders?month=2026-10', {
    token: 'synthetic-vendor-token', lineUserId: 'synthetic-line-vendor-a', now: afterCutoff
  });
  assert.equal(first.body.days[0].source, 'SNAPSHOT');
  assert.equal(first.body.days[0].revision, 1);
  assert.equal(first.body.days[0].amountTwd, 170);
  const payment = await call(database, '/api/admin/vendor-payments', {
    method: 'POST', token: 'synthetic-admin-token', lineUserId: 'synthetic-line-admin',
    body: {
      vendorId: 'synthetic-vendor-a', amountTwd: 100, transferredOn: '2026-10-20',
      actualTransferDone: true, detailsReviewed: true,
      idempotencyKey: 'synthetic-postcutoff-transfer',
      allocations: [{ serviceDate: '2026-10-20', amountTwd: 100 }]
    },
    now: afterCutoff
  });
  assert.equal(payment.response.status, 201, JSON.stringify(payment.body));
  database.run("UPDATE orders SET status = 'CANCELLED', updated_at = '2026-10-20T03:01:00.000Z' WHERE order_id = 'synthetic-order-post-cutoff'");
  database.run(`
    INSERT INTO order_status_history (
      transition_id, order_id, from_status, to_status, actor_user_id, actor_auth_mode,
      display_name_snapshot, reason, metadata_json, occurred_at
    ) VALUES ('synthetic-transition-cancel', 'synthetic-order-post-cutoff', 'ACTIVE', 'CANCELLED',
      'synthetic-buyer-a', 'line', 'Synthetic Buyer', 'ORDER_CANCELLED', '{}', '2026-10-20T03:01:00.000Z')
  `);
  const adjusted = await call(database, '/api/vendor/orders?month=2026-10', {
    token: 'synthetic-vendor-token', lineUserId: 'synthetic-line-vendor-a',
    now: new Date('2026-10-20T03:02:00.000Z')
  });
  assert.equal(adjusted.body.days[0].revision, 2);
  assert.equal(adjusted.body.days[0].amountTwd, 0);
  assert.equal(adjusted.body.days[0].changeReason, 'ORDER_CANCELLATION_REFUND');
  assert.equal(adjusted.body.days[0].settlement.overAllocatedTwd, 100);
  const allocationId = database.get(
    'SELECT allocation_id FROM vendor_transfer_allocations WHERE payment_id = ?', payment.body.paymentId
  ).allocation_id;
  const correction = await call(database,
    `/api/admin/vendor-payment-allocations/${allocationId}/adjustments`, {
      method: 'POST', token: 'synthetic-admin-token', lineUserId: 'synthetic-line-admin',
      body: { deltaTwd: -100, reason: 'Synthetic canceled order refund adjustment' },
      now: new Date('2026-10-20T03:03:00.000Z')
    });
  assert.equal(correction.response.status, 200, JSON.stringify(correction.body));
  const corrected = await call(database, '/api/vendor/orders?month=2026-10', {
    token: 'synthetic-vendor-token', lineUserId: 'synthetic-line-vendor-a',
    now: new Date('2026-10-20T03:04:00.000Z')
  });
  assert.equal(corrected.body.days[0].settlement.overAllocatedTwd, 0);
  assert.equal(corrected.body.days[0].settlement.registeredTransferTwd, 0);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM vendor_transfer_allocation_events').count, 1);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM vendor_day_snapshots').count, 2);
  assert.throws(() => database.run("UPDATE vendor_day_snapshots SET amount_twd = 0"), /VENDOR_SNAPSHOT_APPEND_ONLY/);
  assert.equal(database.get('SELECT COUNT(*) AS count FROM balance_ledger').count, 0);
});
