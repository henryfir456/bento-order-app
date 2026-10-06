import { auditStatement } from '../db/audit.js';
import { ledgerMutationStatements } from '../db/ledgerQueries.js';
import { prepareStatement, randomId, resolveClock, runMutationBatch } from '../db/transactions.js';
import { deadlineInfo, getTaipeiDate, isDateOnly } from './deadlines.js';
import { normalizeMenuVendor } from './menuVendors.js';

const rowsFrom = (result) => (
  Array.isArray(result) ? result : (Array.isArray(result?.results) ? result.results : [])
);

const effectiveMode = (row) => (row.mode === 'B' ? 'B' : 'A');

const statementChanges = (result) => Number(
  result?.meta?.changes ?? result?.changes ?? 0
);

export const getCalendarSetting = async (database, orderDate) => {
  if (!isDateOnly(orderDate)) return null;
  const row = await database.prepare(`
    SELECT order_date, vendor, mode, vendor_source
    FROM calendar_settings
    WHERE order_date = ?
    LIMIT 1
  `).bind(orderDate).first();
  return row
    ? { order_date: row.order_date, vendor: normalizeMenuVendor(row.vendor), mode: effectiveMode(row) }
    : null;
};

export const persistCalendarSetting = async (
  database,
  {
    orderDate,
    vendor,
    mode,
    vendorSource = 'CONFIGURED',
    updatedByUserId = null,
    onlyIfUnassigned = false,
    audit = null
  },
  clock = new Date()
) => {
  const occurredAt = resolveClock(clock).toISOString();
  const conditionalClause = onlyIfUnassigned
    ? `
    WHERE length(trim(calendar_settings.vendor)) = 0`
    : '';
  const upsert = prepareStatement(database, `
    INSERT INTO calendar_settings (
      order_date, vendor, mode, vendor_source, updated_by_user_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(order_date) DO UPDATE SET
      vendor = excluded.vendor,
      mode = excluded.mode,
      vendor_source = excluded.vendor_source,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at = excluded.updated_at${conditionalClause}
  `, [
    orderDate,
    vendor,
    mode,
    vendorSource,
    updatedByUserId,
    occurredAt,
    occurredAt
  ]);
  const statements = [upsert];
  if (audit) {
    statements.push(auditStatement(database, {
      ...audit,
      occurredAt
    }));
  }
  const results = await runMutationBatch(database, statements);
  return {
    changed: statementChanges(results[0]) === 1,
    setting: await getCalendarSetting(database, orderDate)
  };
};

export const cancelCalendarGroup = async (
  database,
  { identity, orderDate, mode = 'A' },
  clock = new Date()
) => {
  const occurredAt = resolveClock(clock).toISOString();
  const actor = identity.actor;
  const activeResult = await database.prepare(`
    SELECT o.order_id, o.user_id, o.total_amount,
           u.employee_id, u.line_user_id, u.display_name,
           COALESCE(SUM(oi.quantity), 0) AS total_quantity,
           EXISTS (
             SELECT 1 FROM balance_ledger bl
             WHERE bl.type = 'REFUND' AND bl.reference_id = o.order_id
           ) AS has_refund
    FROM orders o
    JOIN users u ON u.user_id = o.user_id
    LEFT JOIN order_items oi ON oi.order_id = o.order_id
    WHERE o.order_date = ? AND o.status = 'ACTIVE'
    GROUP BY o.order_id, o.user_id, o.total_amount,
             u.employee_id, u.line_user_id, u.display_name
    ORDER BY o.order_id
  `).bind(orderDate).all();
  const activeOrders = rowsFrom(activeResult);

  if (activeOrders.some((order) => Number(order.has_refund) === 1)) {
    const error = new Error('Active order already has a refund.');
    error.code = 'CALENDAR_REFUND_INVARIANT';
    throw error;
  }

  const statements = [];
  for (const order of activeOrders) {
    const activeGuard = {
      sql: `EXISTS (
        SELECT 1 FROM orders current_order
        WHERE current_order.order_id = ?
          AND current_order.user_id = ?
          AND current_order.order_date = ?
          AND current_order.status = 'ACTIVE'
      )`,
      params: [order.order_id, order.user_id, orderDate]
    };
    const refundableGuard = {
      sql: `${activeGuard.sql}
        AND NOT EXISTS (
          SELECT 1 FROM balance_ledger bl
          WHERE bl.type = 'REFUND' AND bl.reference_id = ?
        )`,
      params: [...activeGuard.params, order.order_id]
    };

    statements.push(...ledgerMutationStatements(database, {
      transactionId: randomId('txn'),
      userId: order.user_id,
      employeeIdSnapshot: order.employee_id,
      lineUserIdSnapshot: order.line_user_id,
      displayNameSnapshot: order.display_name,
      amount: Number(order.total_amount),
      type: 'REFUND',
      referenceId: order.order_id,
      operatorUserId: actor.userId,
      operatorEmployeeIdSnapshot: actor.employeeId,
      operatorLineUserIdSnapshot: actor.lineUserId,
      operatorDisplayNameSnapshot: actor.displayName,
      operatorAuthMode: actor.authMode,
      authMode: actor.authMode,
      note: 'GROUP_CANCELLED',
      occurredAt
    }, {
      guard: refundableGuard,
      dynamicBalanceAfter: true
    }).statements);

    statements.push(prepareStatement(database, `
      INSERT INTO order_status_history (
        transition_id, order_id, from_status, to_status, actor_user_id,
        actor_auth_mode, employee_id_snapshot, line_user_id_snapshot,
        display_name_snapshot, reason, metadata_json, occurred_at
      )
      SELECT ?, o.order_id, 'ACTIVE', 'CANCELLED', ?, ?, u.employee_id,
             u.line_user_id, u.display_name, 'GROUP_CANCELLED', ?, ?
      FROM orders o
      JOIN users u ON u.user_id = o.user_id
      WHERE o.order_id = ? AND o.user_id = ? AND o.order_date = ?
        AND o.status = 'ACTIVE'
    `, [
      randomId('transition'),
      actor.userId,
      actor.authMode,
      JSON.stringify({ orderDate }),
      occurredAt,
      order.order_id,
      order.user_id,
      orderDate
    ]));

    statements.push(prepareStatement(database, `
      UPDATE orders
      SET status = 'CANCELLED',
          cancelled_by_user_id = ?,
          cancelled_auth_mode = ?,
          updated_at = ?
      WHERE order_id = ? AND user_id = ? AND order_date = ? AND status = 'ACTIVE'
    `, [
      actor.userId,
      actor.authMode,
      occurredAt,
      order.order_id,
      order.user_id,
      orderDate
    ]));
  }

  statements.push(prepareStatement(database, `
    INSERT INTO calendar_settings (
      order_date, vendor, mode, vendor_source, updated_by_user_id,
      created_at, updated_at
    ) VALUES (?, '', ?, 'CONFIGURED', ?, ?, ?)
    ON CONFLICT(order_date) DO UPDATE SET
      vendor = '',
      mode = excluded.mode,
      vendor_source = 'CONFIGURED',
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at = excluded.updated_at
  `, [orderDate, mode, actor.userId, occurredAt, occurredAt]));

  const summary = {
    userCount: new Set(activeOrders.map((order) => order.user_id)).size,
    orderCount: activeOrders.length,
    totalQuantity: activeOrders.reduce((sum, order) => sum + Number(order.total_quantity || 0), 0),
    totalAmount: activeOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0)
  };

  statements.push(auditStatement(database, {
    auditId: randomId('audit'),
    actorUserId: actor.userId,
    actorAuthMode: actor.authMode,
    actorEmployeeIdSnapshot: actor.employeeId,
    actorLineUserIdSnapshot: actor.lineUserId,
    action: 'CALENDAR_SETTING_UPDATED',
    metadata: {
      orderDate,
      vendor: '',
      mode,
      groupCancellation: true,
      ...summary
    },
    occurredAt
  }));

  await runMutationBatch(database, statements);
  return {
    success: true,
    setting: await getCalendarSetting(database, orderDate),
    cancellationSummary: summary
  };
};

export const getCalendarEvents = async (
  database,
  {
    fromDate = null,
    toDate = null,
    now = new Date(),
    includeLikes = false,
    userId = null,
    includeSource = false
  } = {}
) => {
  const result = await database.prepare(`
    SELECT order_date, vendor, mode, vendor_source
    FROM calendar_settings
    ORDER BY order_date ASC
  `).all();
  const orderQuantitiesResult = await database.prepare(`
    SELECT o.order_date, SUM(oi.quantity) AS total_quantity
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.order_id
    WHERE o.status <> 'CANCELLED'
    GROUP BY o.order_date
    ORDER BY o.order_date ASC
  `).all();
  const dailyFlavorsResult = await database.prepare(`
    SELECT flavor.service_date, flavor.flavor_name, flavor.image_url,
      EXISTS (
        SELECT 1 FROM taiwan_government_holidays holiday
        WHERE holiday.holiday_date = flavor.service_date
      ) AS is_holiday
    FROM vendor_daily_flavors flavor
    WHERE flavor.vendor = '蔡老師'
    ORDER BY flavor.service_date ASC
  `).all();
  const events = {};
  const likesResult = includeLikes
    ? await database.prepare(`
      SELECT order_date, user_id
      FROM likes
      ORDER BY order_date ASC, user_id ASC
    `).all()
    : { results: [] };
  const likeRows = rowsFrom(likesResult);
  const orderQuantitiesByDate = rowsFrom(orderQuantitiesResult).reduce((totals, row) => {
    totals[row.order_date] = Number(row.total_quantity || 0);
    return totals;
  }, {});
  const dailyFlavorsByDate = rowsFrom(dailyFlavorsResult).reduce((flavors, row) => {
    const date = String(row.service_date || '').trim();
    const name = String(row.flavor_name || '').trim();
    if (isDateOnly(date) && name) {
      flavors[date] = {
        name,
        imageUrl: row.is_holiday ? '' : String(row.image_url || '').trim()
      };
    }
    return flavors;
  }, {});
  const likesByDate = likeRows.reduce((result, row) => {
    const current = result[row.order_date] || { count: 0, users: new Set() };
    current.count += 1;
    current.users.add(row.user_id);
    result[row.order_date] = current;
    return result;
  }, {});
  for (const row of rowsFrom(result)) {
    if (!isDateOnly(row.order_date)) continue;
    if (fromDate && row.order_date < fromDate) continue;
    if (toDate && row.order_date > toDate) continue;
    const vendor = normalizeMenuVendor(row.vendor);
    const mode = effectiveMode(row);
    const likeState = likesByDate[row.order_date] || { count: 0, users: new Set() };
    events[row.order_date] = {
      order_date: row.order_date,
      vendor,
      mode,
      deadline: deadlineInfo(row.order_date, mode, now)?.deadline || null,
      isExpired: Boolean(deadlineInfo(row.order_date, mode, now)?.isExpired),
      lunarLabel: null,
      totalQuantity: orderQuantitiesByDate[row.order_date] || 0,
      ...(dailyFlavorsByDate[row.order_date] ? {
        dailyFlavorName: dailyFlavorsByDate[row.order_date].name,
        ...((!vendor || vendor === '蔡老師') && dailyFlavorsByDate[row.order_date].imageUrl
          ? { dailyFlavorImageUrl: dailyFlavorsByDate[row.order_date].imageUrl }
          : {})
      } : {}),
      ...(includeLikes ? {
        likeCount: likeState.count,
        isUserLiked: likeState.users.has(userId),
        ...(includeSource ? { vendorSource: row.vendor_source || 'CONFIGURED' } : {})
      } : {})
    };
  }
  if (includeLikes) {
    for (const [date, likeState] of Object.entries(likesByDate)) {
      if (events[date] || (fromDate && date < fromDate) || (toDate && date > toDate)) continue;
      const fallback = deadlineInfo(date, 'A', now);
      events[date] = {
        order_date: date,
        vendor: '',
        mode: 'A',
        deadline: fallback?.deadline || null,
        isExpired: Boolean(fallback?.isExpired),
        lunarLabel: null,
        totalQuantity: orderQuantitiesByDate[date] || 0,
        ...(dailyFlavorsByDate[date] ? {
          dailyFlavorName: dailyFlavorsByDate[date].name,
          ...(dailyFlavorsByDate[date].imageUrl
            ? { dailyFlavorImageUrl: dailyFlavorsByDate[date].imageUrl }
            : {})
        } : {}),
        likeCount: likeState.count,
        isUserLiked: likeState.users.has(userId),
        ...(includeSource ? { vendorSource: 'LIKE_DEFAULT' } : {})
      };
    }
  }
  for (const [date, dailyFlavor] of Object.entries(dailyFlavorsByDate)) {
    if (events[date] || (fromDate && date < fromDate) || (toDate && date > toDate)) continue;
    const fallback = deadlineInfo(date, 'A', now);
    events[date] = {
      order_date: date,
      vendor: '',
      mode: 'A',
      deadline: fallback?.deadline || null,
      isExpired: Boolean(fallback?.isExpired),
      lunarLabel: null,
      totalQuantity: orderQuantitiesByDate[date] || 0,
      dailyFlavorName: dailyFlavor.name,
      ...(dailyFlavor.imageUrl ? { dailyFlavorImageUrl: dailyFlavor.imageUrl } : {}),
      ...(includeLikes ? {
        likeCount: 0,
        isUserLiked: false,
        ...(includeSource ? { vendorSource: 'DAILY_FLAVOR_DEFAULT' } : {})
      } : {})
    };
  }
  return events;
};

export const getLikes = async (database, { userId, now = new Date() } = {}) => {
  const result = await database.prepare(`
    SELECT order_date, user_id
    FROM likes
    ORDER BY order_date ASC, user_id ASC
  `).all();
  return rowsFrom(result).reduce((state, row) => {
    const current = state[row.order_date] || {
      likeCount: 0,
      isUserLiked: false,
      calendarEvent: null
    };
    current.likeCount += 1;
    if (row.user_id === userId) current.isUserLiked = true;
    current.calendarEvent = {
      order_date: row.order_date,
      vendor: '',
      mode: 'A',
      deadline: deadlineInfo(row.order_date, 'A', now)?.deadline || null,
      isExpired: Boolean(deadlineInfo(row.order_date, 'A', now)?.isExpired),
      lunarLabel: null
    };
    state[row.order_date] = current;
    return state;
  }, {});
};

export const todayInTaipei = (now = new Date()) => getTaipeiDate(now);
