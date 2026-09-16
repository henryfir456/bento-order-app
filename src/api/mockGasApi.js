import { hasPermission } from '../auth/permissions.js';
import {
  getMockAdminOrders,
  getMockBalanceHistory,
  getMockCalendarEvents,
  getMockIdentityResponse,
  getMockMembers,
  getMockOrderPageData,
  getMockOrdersMap,
  getMockSessionState,
  getMockVendor,
  getMockVendors,
  registerMockUser,
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

const jsonResponse = (data) => new Response(JSON.stringify(data), {
  status: 200,
  headers: { 'Content-Type': 'application/json' }
});

const parseQuery = (query) => {
  const rawQuery = String(query || '').replace(/^\?/, '');
  return new URLSearchParams(rawQuery);
};

const errorResponse = (message) => jsonResponse({ success: false, message });

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

export const createMockGasApi = ({ mockUser }) => {
  const getState = () => getMockSessionState(mockUser);
  const getUser = () => getState().user;

  const get = async (query) => {
    const params = parseQuery(query);
    const action = params.get('action');

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

    if (action === 'getAdminSummary') {
      if (!hasMockPermission(user, 'viewAdminOrderSummary')) {
        return errorResponse('Mock user does not have admin summary permission.');
      }
      const todayOrders = getMockAdminOrders(payload.targetDate);
      return jsonResponse({
        success: true,
        requesterRole: user.role,
        targetDate: String(payload.targetDate || ''),
        usersSummary: [],
        todayOrders,
        totalItems: todayOrders.reduce((total, order) => total + order.quantity, 0),
        totalAmount: todayOrders.reduce((total, order) => total + order.subtotal, 0),
        items: todayOrders.reduce((items, order) => {
          const existing = items.find((item) => item.item_id === order.item_id);
          if (existing) {
            existing.quantity += order.quantity;
            existing.totalAmount += order.subtotal;
          } else {
            items.push({
              item_id: order.item_id,
              item_name: order.item_name,
              quantity: order.quantity,
              totalAmount: order.subtotal
            });
          }
          return items;
        }, []),
        pickupSummary: todayOrders.reduce((summary, order) => {
          const current = summary[order.pickup_floor] || { totalItems: 0, totalAmount: 0 };
          current.totalItems += order.quantity;
          current.totalAmount += order.subtotal;
          summary[order.pickup_floor] = current;
          return summary;
        }, {})
      });
    }

    if (action === 'getMemberBalances') {
      return hasMockPermission(user, 'viewMemberBalances')
        ? jsonResponse({ success: true, requesterRole: user.role, members: getMockMembers(mockUser) })
        : errorResponse('Mock user does not have member balance permission.');
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

    return errorResponse(MOCK_API_UNSUPPORTED);
  };

  return { get, post };
};
