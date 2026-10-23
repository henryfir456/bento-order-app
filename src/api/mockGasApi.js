import { hasPermission } from '../auth/permissions.js';
import {
  getMockAdminOrders,
  getMockBalanceHistory,
  getMockCalendarEvents,
  getMockAnnouncements,
  getMockIdentityResponse,
  getMockMembers,
  getMockOrderPageData,
  getMockOrderStatistics,
  getMockOrdersMap,
  getMockSessionState,
  configureMockVendorPaymentStorage,
  getMockVendor,
  getMockVendorOperations,
  getMockVendors,
  registerMockUser,
  recordMockVendorPayment,
  reverseMockVendorPayment,
  updateMockVendorPayment,
  adjustMockVendorAllocation,
  updateMockVendor
} from '../auth/mockData.js';

const VALID_FLOORS = ['1樓', '9樓'];
const MOCK_API_UNSUPPORTED = 'This API is not implemented by the local mock adapter.';

const hasMockPermission = (user, permission) => hasPermission(
  user?.role,
  permission,
  user?.authMode || (user?.authSource === 'EMPLOYEE_GUEST' ? 'employee_guest' : 'line'),
  user?.registered !== false
);

const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

const parseQuery = (query) => {
  const rawQuery = String(query || '').replace(/^\?/, '');
  return new URLSearchParams(rawQuery);
};

const errorResponse = (message, status = 200) => jsonResponse({ success: false, message }, status);

const isMockLineAdmin = (user) => user?.role === 'Admin'
  && (user?.authMode || (user?.authSource === 'EMPLOYEE_GUEST' ? 'employee_guest' : 'line')) === 'line'
  && user?.registered !== false;

const mockRepairUser = (member) => ({
  userId: member.userId,
  employeeId: member.employeeId,
  displayName: member.name,
  pickupFloor: member.floor,
  role: member.role,
  active: member.active !== false,
  invalidReason: member.invalidReason || null,
  lineBound: Boolean(member.lineBound),
  balance: Number(member.balance || 0),
  updatedAt: member.updatedAt
});

const getMockCoreIdentityResponse = (mockUser) => {
  const identity = getMockIdentityResponse(mockUser);
  if (!identity.registered) return identity;

  const events = Object.fromEntries(Object.entries(identity.calendar.events).map(([date, event]) => {
    const { likeCount: _likeCount, isUserLiked: _isUserLiked, ...coreEvent } = event;
    return [date, coreEvent];
  }));

  return {
    ...identity,
    calendar: {
      events,
      announcements: [],
      announcement: null
    }
  };
};

const getMockDeferredUiResponse = (mockUser) => {
  const identity = getMockIdentityResponse(mockUser);
  const likes = Object.fromEntries(Object.entries(identity.calendar?.events || {}).map(([date, event]) => [
    date,
    {
      likeCount: event.likeCount,
      isUserLiked: event.isUserLiked
    }
  ]));

  return {
    success: true,
    registered: true,
    likes,
    announcements: identity.calendar?.announcements || [],
    announcement: identity.calendar?.announcement || null
  };
};

export const createMockGasApi = ({ mockUser, storage } = {}) => {
  configureMockVendorPaymentStorage(storage);
  const getState = () => getMockSessionState(mockUser);
  const getUser = () => getState().user;

  const get = async (query) => {
    const params = parseQuery(query);
    const action = params.get('action');
    const user = getUser();

    if (action === 'getCalendarEvents') {
      return jsonResponse({
        success: true,
        events: getMockCalendarEvents(mockUser),
        announcements: getMockIdentityResponse(mockUser).calendar?.announcements || []
      });
    }

    if (action === 'getUserAllOrdersMap') {
      return getUser()
        ? jsonResponse({ success: true, ordersMap: getMockOrdersMap(mockUser) })
        : errorResponse('Mock user is not registered.');
    }

    if (action === 'getOrderPageData') {
      return getUser()
        ? jsonResponse(getMockOrderPageData(mockUser, params.get('targetDate')))
        : errorResponse('Mock user is not registered.');
    }

    if (action === 'getVendors') {
      return getUser()
        ? jsonResponse({ success: true, vendors: getMockVendors(mockUser) })
        : errorResponse('Mock user is not registered.');
    }

    if (action === 'getVendor') {
      const vendor = getUser() ? getMockVendor(mockUser, params.get('vendorId')) : null;
      return vendor ? jsonResponse(vendor) : errorResponse('VENDOR_NOT_FOUND');
    }

    if (action === 'getVendorOperations') {
      return user?.role === 'Vendor'
        ? jsonResponse(getMockVendorOperations(mockUser, { month: params.get('month') }))
        : errorResponse('VENDOR_SCOPE_FORBIDDEN', 403);
    }

    if (action === 'getVendorHistoryImport') {
      if (!isMockLineAdmin(user)) return errorResponse('ADMIN_LINE_AUTH_REQUIRED', 403);
      return jsonResponse({ success: true, versionCount: 0, nameCount: 0, orderCount: 0, dayCount: 0 });
    }

    if (action === 'getAdminVendorOperations') {
      if (!isMockLineAdmin(user)) return errorResponse('ADMIN_LINE_AUTH_REQUIRED', 403);
      return jsonResponse(getMockVendorOperations(mockUser, {
        month: params.get('month'),
        vendorId: params.get('vendorId')
      }));
    }

    if (action === 'getOrderStatistics') {
      return getUser()
        ? jsonResponse({ success: true, ...getMockOrderStatistics(params.get('period') || 'all') })
        : errorResponse('Mock user is not registered.');
    }

    return errorResponse(MOCK_API_UNSUPPORTED);
  };

  const post = async (payload = {}) => {
    const action = payload.action;
    const state = getState();
    const user = state.user;

    if (action === 'getBootstrapData') {
      return jsonResponse({
        ...(payload.deferUiData === true
          ? getMockCoreIdentityResponse(mockUser)
          : getMockIdentityResponse(mockUser)),
        bootId: payload.bootId
      });
    }

    if (action === 'getDeferredBootstrapData') {
      return getUser()
        ? jsonResponse({ ...getMockDeferredUiResponse(mockUser), bootId: payload.bootId })
        : errorResponse('Mock user is not registered.');
    }

    if (action === 'getUserInfo') {
      const identity = getMockIdentityResponse(mockUser);
      return jsonResponse(identity.registered
        ? { success: true, registered: true, user: identity.user }
        : identity);
    }

    if (action === 'registerUser') {
      const pickupFloor = String(payload.pickupFloor || '').trim();
      if (!VALID_FLOORS.includes(pickupFloor)) return errorResponse('Mock pickup floor is invalid.');
      const registeredUser = registerMockUser(mockUser, pickupFloor);
      return jsonResponse({ success: true, registered: true, user: registeredUser });
    }

    if (!user) return errorResponse('Mock user is not registered.');

    if (action === 'getMyAnnouncements') {
      const announcements = getMockAnnouncements(mockUser);
      return jsonResponse({
        success: true,
        announcements,
        unreadCount: announcements.filter((announcement) => !announcement.readAt).length
      });
    }

    if (['markAnnouncementRead', 'dismissAnnouncementAutoPopup'].includes(action)) {
      const announcementId = String(payload.announcementId || '').trim();
      if (!['mock-announcement-1', 'mock-announcement-2', 'mock-announcement-legacy'].includes(announcementId)) {
        return errorResponse('ANNOUNCEMENT_NOT_FOUND', 404);
      }
      const preference = state.announcementPreferences[announcementId] || {};
      if (action === 'markAnnouncementRead') {
        preference.readAt ||= new Date().toISOString();
        state.announcementPreferences[announcementId] = preference;
        return jsonResponse({ success: true, announcementId, readAt: preference.readAt });
      }
      preference.dismissAutoPopupAt ||= new Date().toISOString();
      state.announcementPreferences[announcementId] = preference;
      return jsonResponse({ success: true, announcementId, dismissAutoPopupAt: preference.dismissAutoPopupAt });
    }

    if (action === 'getAdminSummary') {
      if (!hasMockPermission(user, 'viewAdminOrderSummary')) {
        return errorResponse('Mock user does not have admin summary permission.');
      }
      const todayOrders = getMockAdminOrders(payload.targetDate);
      const itemMap = new Map();
      todayOrders.forEach((order) => {
        const identityKey = order.item_identity_key || order.item_id || order.display_item_name;
        const existing = itemMap.get(identityKey);
        if (existing) {
          existing.quantity += order.quantity;
          existing.totalAmount += order.subtotal;
        } else {
          itemMap.set(identityKey, {
            item_id: order.item_id,
            item_identity_key: identityKey,
            item_name: order.item_name,
            display_item_name: order.display_item_name || order.item_name,
            item_vendor: order.item_vendor || order.vendor,
            item_variant_key: order.item_variant_key || 'BASE',
            quantity: order.quantity,
            totalAmount: order.subtotal
          });
        }
      });
      return jsonResponse({
        success: true,
        requesterRole: user.role,
        targetDate: String(payload.targetDate || ''),
        usersSummary: [],
        todayOrders,
        totalItems: todayOrders.reduce((total, order) => total + order.quantity, 0),
        totalAmount: todayOrders.reduce((total, order) => total + order.subtotal, 0),
        items: [...itemMap.values()],
        pickupSummary: todayOrders.reduce((summary, order) => {
          const current = summary[order.pickup_floor] || { totalItems: 0, totalAmount: 0 };
          current.totalItems += order.quantity;
          current.totalAmount += order.subtotal;
          summary[order.pickup_floor] = current;
          return summary;
        }, {})
      });
    }

    if (action === 'getOrderStatistics') {
      return jsonResponse({ success: true, ...getMockOrderStatistics(payload.period || 'all') });
    }

    if (action === 'getMemberBalances') {
      const includeInvalid = payload.includeInvalid === true;
      if (includeInvalid && !isMockLineAdmin(user)) {
        return errorResponse('ADMIN_LINE_AUTH_REQUIRED', 403);
      }
      return hasMockPermission(user, 'viewMemberBalances')
        ? jsonResponse({ success: true, requesterRole: user.role, includeInvalid, members: getMockMembers(mockUser, { includeInvalid }) })
        : errorResponse('Mock user does not have member balance permission.');
    }

    if (action === 'previewInvalidEmployeeRepair') {
      if (!isMockLineAdmin(user)) return errorResponse('ADMIN_LINE_AUTH_REQUIRED', 403);
      const source = state.members.find((member) => member.userId === String(payload.sourceUserId || ''));
      const target = state.members.find((member) => member.userId === String(payload.targetUserId || ''));
      if (!source) return errorResponse('SOURCE_USER_NOT_FOUND', 404);
      if (!target) return errorResponse('TARGET_USER_NOT_FOUND', 404);
      const conflicts = [];
      if (source.userId === target.userId) conflicts.push('SOURCE_AND_TARGET_SAME');
      if (source.invalidReason === 'INVALID_EMPLOYEE_ID') conflicts.push('SOURCE_ALREADY_INVALID');
      if (source.active === false) conflicts.push('SOURCE_INACTIVE');
      if (source.role !== 'User') conflicts.push('SOURCE_ROLE_NOT_REPAIRABLE');
      if (!String(source.employeeId || '').trim()) conflicts.push('SOURCE_EMPLOYEE_ID_MISSING');
      if (!String(source.name || '').trim()) conflicts.push('SOURCE_NAME_REQUIRED');
      if (target.invalidReason === 'INVALID_EMPLOYEE_ID') conflicts.push('TARGET_ALREADY_INVALID');
      if (target.active === false) conflicts.push('TARGET_INACTIVE');
      if (!String(target.employeeId || '').trim()) conflicts.push('TARGET_EMPLOYEE_ID_MISSING');
      if (!String(target.name || '').trim()) conflicts.push('TARGET_NAME_REQUIRED');
      if (state.invalidEmployeeRepairs.some((entry) => entry.sourceUserId === source.userId)) {
        conflicts.push('REPAIR_ALREADY_RECORDED');
      }
      return jsonResponse({
        success: true,
        readyToRepair: conflicts.length === 0,
        conflicts,
        source: mockRepairUser(source),
        target: mockRepairUser(target),
        changes: {
          sourceInvalidReason: 'INVALID_EMPLOYEE_ID',
          sourceActive: false,
          targetDisplayName: source.name,
          targetLineBindingPreserved: true,
          targetRolePreserved: true,
          targetEmployeeIdPreserved: true,
          targetPickupFloorPreserved: true,
          targetOrdersAndAccountingPreserved: true,
          lineBindingTransferPerformed: false
        }
      });
    }

    if (action === 'repairInvalidEmployee') {
      if (!isMockLineAdmin(user)) return errorResponse('ADMIN_LINE_AUTH_REQUIRED', 403);
      const source = state.members.find((member) => member.userId === String(payload.sourceUserId || ''));
      const target = state.members.find((member) => member.userId === String(payload.targetUserId || ''));
      if (!source) return errorResponse('SOURCE_USER_NOT_FOUND', 404);
      if (!target) return errorResponse('TARGET_USER_NOT_FOUND', 404);
      const hasRepair = state.invalidEmployeeRepairs.some((entry) => entry.sourceUserId === source.userId);
      const stale = source.updatedAt !== payload.expectedSourceUpdatedAt
        || target.updatedAt !== payload.expectedTargetUpdatedAt
        || source.name !== payload.expectedSourceDisplayName
        || source.employeeId !== payload.expectedSourceEmployeeId
        || target.employeeId !== payload.expectedTargetEmployeeId
        || Number(source.balance) !== Number(payload.expectedSourceBalance)
        || Number(target.balance) !== Number(payload.expectedTargetBalance);
      if (hasRepair || stale || source.invalidReason || source.active === false
        || source.role !== 'User' || target.invalidReason || target.active === false) {
        return errorResponse('INVALID_EMPLOYEE_REPAIR_STALE', 409);
      }
      if (payload.confirmTargetDisplayName !== target.name) {
        return errorResponse('TARGET_NAME_CONFIRMATION_REQUIRED', 409);
      }
      const occurredAt = new Date().toISOString();
      const audit = {
        auditId: `mock-audit-${state.invalidEmployeeRepairs.length + 1}`,
        requestId: `mock-request-${state.invalidEmployeeRepairs.length + 1}`,
        sourceUserId: source.userId,
        sourceEmployeeId: source.employeeId,
        sourceDisplayName: source.name,
        sourceBalance: Number(source.balance),
        sourceActive: false,
        sourceInvalidReason: 'INVALID_EMPLOYEE_ID',
        targetUserId: target.userId,
        targetEmployeeId: target.employeeId,
        targetOriginalDisplayName: target.name,
        targetDisplayName: source.name,
        targetRole: target.role,
        targetPickupFloor: target.floor,
        targetLineBound: Boolean(target.lineBound),
        targetBalance: Number(target.balance),
        actorUserId: user.userId,
        occurredAt
      };
      source.active = false;
      source.invalidReason = 'INVALID_EMPLOYEE_ID';
      source.updatedAt = occurredAt;
      target.name = source.name;
      target.updatedAt = occurredAt;
      state.invalidEmployeeRepairs.push(audit);
      return jsonResponse({
        success: true,
        source: mockRepairUser(source),
        target: mockRepairUser(target),
        requestId: audit.requestId,
        auditRecorded: true
      });
    }

    if (action === 'getInvalidEmployeeRepairAudit') {
      return isMockLineAdmin(user)
        ? jsonResponse({ success: true, repairs: [...state.invalidEmployeeRepairs].reverse() })
        : errorResponse('ADMIN_LINE_AUTH_REQUIRED', 403);
    }

    if (action === 'getAdminUserLedger') {
      if (!isMockLineAdmin(user)) return errorResponse('ADMIN_LINE_AUTH_REQUIRED', 403);
      const member = state.members.find((entry) => entry.userId === String(payload.userId || ''));
      if (!member) return errorResponse('USER_NOT_FOUND', 404);
      const balance = Number(member.balance) || 0;
      return jsonResponse({
        success: true,
        userId: member.userId,
        month: payload.month,
        openingBalance: balance,
        closingBalance: balance,
        totalCredit: 0,
        totalDebit: 0,
        transactions: [],
        reconciliation: { status: 'CONSISTENT' }
      });
    }

    if (action === 'getBalanceHistoryByMonth') {
      return jsonResponse(getMockBalanceHistory(mockUser, payload.year, payload.month));
    }

    if (action === 'updateMyPickupFloor') {
      const pickupFloor = String(payload.pickupFloor || '').trim();
      if (!VALID_FLOORS.includes(pickupFloor)) return errorResponse('Mock pickup floor is invalid.');
      user.floor = pickupFloor;
      user.defaultFloor = pickupFloor;
      const member = state.members.find((candidate) => candidate.userId === user.userId);
      if (member) {
        member.floor = pickupFloor;
        member.defaultFloor = pickupFloor;
      }
      return jsonResponse({ success: true, user: { ...user } });
    }

    if (action === 'toggleLike') {
      const date = String(payload.date || '');
      if (state.likes.has(date)) state.likes.delete(date);
      else state.likes.add(date);
      return jsonResponse({ success: true });
    }

    if (action === 'adminSetVendor') {
      if (!hasMockPermission(user, 'manageCalendar')) {
        return errorResponse('Mock user does not have calendar permission.');
      }
      state.vendors[String(payload.dateStr || '')] = String(payload.vendor || '');
      return jsonResponse({ success: true });
    }

    if (action === 'submitOrder') {
      if (!hasMockPermission(user, 'orderOwn')) return errorResponse('Mock user cannot submit orders.');
      const date = String(payload.target_date || '');
      const items = Array.isArray(payload.items) ? payload.items : [];
      const normalizedItems = items
        .map((item) => ({
          item_id: String(item.item_id || ''),
          item_name: String(item.item_name || ''),
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price)
        }))
        .filter((item) => item.item_id && item.quantity > 0 && Number.isFinite(item.unit_price))
        .map((item) => ({ ...item, subtotal: item.quantity * item.unit_price }));

      if (!date || normalizedItems.length === 0) return errorResponse('Mock order requires a date and items.');

      const existing = state.orders.find((order) => order.date === date);
      if (existing) {
        user.balance += existing.items.reduce((total, item) => total + item.subtotal, 0);
      }
      state.orders = state.orders.filter((order) => order.date !== date);
      state.orderSequence = (state.orderSequence || 0) + 1;
      const order = {
        orderId: `MOCK-${user.userId}-${state.orderSequence}`,
        date,
        floor: String(payload.pickup_floor || user.defaultFloor),
        note: String(payload.note || ''),
        items: normalizedItems
      };
      user.balance -= normalizedItems.reduce((total, item) => total + item.subtotal, 0);
      state.orders.push(order);
      return jsonResponse({ success: true, newBalance: user.balance, orderId: order.orderId });
    }

    if (action === 'cancelOrder') {
      const orderIndex = state.orders.findIndex((order) => (
        order.orderId === String(payload.orderId || '')
        && order.date === String(payload.date || '')
      ));
      if (orderIndex < 0) return errorResponse('Mock order was not found.');
      const [order] = state.orders.splice(orderIndex, 1);
      user.balance += order.items.reduce((total, item) => total + item.subtotal, 0);
      return jsonResponse({ success: true, newBalance: user.balance });
    }

    if (action === 'topUpBalance') {
      if (!hasMockPermission(user, 'topupMember')) return errorResponse('Mock user cannot top up balances.');
      const targetUserId = String(payload.targetUserId || '');
      const amount = Number(payload.amount);
      const target = state.members.find((member) => member.userId === targetUserId);
      if (!target || !Number.isFinite(amount) || amount <= 0) return errorResponse('Mock top-up is invalid.');
      target.balance += amount;
      if (target.userId === user.userId) user.balance = target.balance;
      return jsonResponse({ success: true, newBalance: target.balance, targetUserId });
    }

    if (action === 'updateVendor') {
      if (!hasMockPermission(user, 'manageVendors')) {
        return errorResponse('Mock user does not have vendor permission.');
      }
      const fields = [
        'description',
        'phone',
        'address',
        'website_url',
        'menu_source_url',
        'menu_image_url',
        'menu_updated_at',
        'enabled'
      ];
      const patch = Object.fromEntries(fields
        .filter((field) => Object.prototype.hasOwnProperty.call(payload, field))
        .map((field) => [field, payload[field]]));
      const vendor = updateMockVendor(mockUser, payload.vendorId, patch);
      return vendor ? jsonResponse(vendor) : errorResponse('VENDOR_NOT_FOUND');
    }

    if (action === 'applyVendorHistoryImport') {
      if (!isMockLineAdmin(user)) return errorResponse('ADMIN_LINE_AUTH_REQUIRED', 403);
      if (Number(payload?.expectedVersions) !== 0 || Number(payload?.expectedNames || 0) !== 0) return errorResponse('VENDOR_HISTORY_PREVIEW_STALE', 409);
      return jsonResponse({ success: true, versionCount: 0, nameCount: 0, importedVersions: 0, importedNames: 0 });
    }

    if (action === 'recordVendorPayment') {
      if (!isMockLineAdmin(user)) return errorResponse('ADMIN_LINE_AUTH_REQUIRED', 403);
      const result = recordMockVendorPayment(mockUser, payload);
      if (result.error === 'VENDOR_NOT_FOUND') {
        return jsonResponse({ success: false, error: result.error }, 404);
      }
      const status = result.error === 'PAYMENT_CONFIRMATION_REQUIRED' ? 400 : 201;
      return result.error ? errorResponse(result.error, status) : jsonResponse({ success: true, ...result }, 201);
    }

    if (action === 'reverseVendorPayment') {
      if (!isMockLineAdmin(user)) return errorResponse('ADMIN_LINE_AUTH_REQUIRED', 403);
      const result = reverseMockVendorPayment(
        mockUser,
        String(payload.paymentId || ''),
        payload.reason,
        payload.confirmed
      );
      const status = result.error === 'PAYMENT_NOT_FOUND' ? 404
        : result.error === 'REVERSAL_REASON_REQUIRED' || result.error === 'PAYMENT_REVERSAL_CONFIRMATION_REQUIRED' ? 400
          : result.error ? 409 : 200;
      return result.error ? errorResponse(result.error, status) : jsonResponse({ success: true, ...result });
    }

    if (action === 'acknowledgeVendorPayment' || action === 'disputeVendorPayment') {
      const reason = String(payload.reason || '').trim();
      if (action === 'disputeVendorPayment' && (!reason || reason.length > 500)) {
        return errorResponse('DISPUTE_REASON_REQUIRED', 400);
      }
      const result = updateMockVendorPayment(
        mockUser,
        String(payload.paymentId || ''),
        action === 'disputeVendorPayment' ? 'DISPUTED' : 'ACKNOWLEDGED',
        reason
      );
      return result.error ? errorResponse(result.error, result.error === 'PAYMENT_NOT_FOUND' ? 404 : 409)
        : jsonResponse({ success: true, ...result });
    }

    if (action === 'resolveVendorPaymentDispute') {
      if (!isMockLineAdmin(user)) return errorResponse('ADMIN_LINE_AUTH_REQUIRED', 403);
      const resolution = String(payload.resolution || '').trim();
      if (!resolution || resolution.length > 500) return errorResponse('RESOLUTION_REQUIRED', 400);
      const result = updateMockVendorPayment(mockUser, String(payload.paymentId || ''), 'RESOLVED', resolution);
      return result.error ? errorResponse(result.error, 409) : jsonResponse({ success: true, ...result });
    }

    if (action === 'adjustVendorPaymentAllocation') {
      if (!isMockLineAdmin(user)) return errorResponse('ADMIN_LINE_AUTH_REQUIRED', 403);
      const reason = String(payload.reason || '').trim();
      const deltaTwd = Number(payload.deltaTwd);
      if (!reason || reason.length > 500 || !Number.isSafeInteger(deltaTwd) || deltaTwd === 0) {
        return errorResponse('ALLOCATION_ADJUSTMENT_INVALID', 400);
      }
      const result = adjustMockVendorAllocation(mockUser, String(payload.allocationId || ''), deltaTwd);
      return result.error ? errorResponse(result.error, 409) : jsonResponse({ success: true, ...result });
    }

    return errorResponse(MOCK_API_UNSUPPORTED);
  };

  return { get, post };
};
