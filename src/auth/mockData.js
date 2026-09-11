const MOCK_VENDORS = Object.freeze(['Mock Bento A', 'Mock Bento B']);

const MOCK_USER_FIXTURES = Object.freeze({
  user: Object.freeze({
    userId: 'mock-user-id',
    employeeId: 'MCKUSR',
    name: 'Mock User',
    floor: '1樓',
    defaultFloor: '1樓',
    balance: 500,
    role: 'User'
  }),
  admin: Object.freeze({
    userId: 'mock-admin-id',
    employeeId: 'MCKADM',
    name: 'Mock Admin',
    floor: '9樓',
    defaultFloor: '9樓',
    balance: 1200,
    role: 'Admin'
  }),
  'proxy-admin': Object.freeze({
    userId: 'mock-proxy-admin-id',
    employeeId: 'MCKPRX',
    name: 'Mock Proxy Admin',
    floor: '1樓',
    defaultFloor: '1樓',
    balance: 700,
    role: 'ProxyAdmin'
  }),
  unregistered: null
});

const sessionStates = new Map();

const clone = (value) => JSON.parse(JSON.stringify(value));

const toDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDays = (dateKey, days) => {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
};

const getPrimaryDate = () => toDateKey(new Date());

const createSeedOrder = (user, orderDate) => ({
  orderId: `MOCK-${user.userId}-ORDER`,
  date: orderDate,
  floor: user.defaultFloor,
  note: 'mock fixture',
  items: [{
    item_id: 'MOCK-001',
    item_name: 'Mock Bento',
    quantity: 1,
    unit_price: 80,
    subtotal: 80
  }]
});

const createSessionState = (mockUser) => {
  const fixture = MOCK_USER_FIXTURES[mockUser];
  const user = fixture ? clone(fixture) : null;
  return {
    user,
    orders: user ? [createSeedOrder(user, getPrimaryDate())] : [],
    orderSequence: 0,
    likes: new Set(),
    vendors: {},
    members: Object.values(MOCK_USER_FIXTURES)
      .filter(Boolean)
      .map(clone)
  };
};

export const getMockSessionState = (mockUser) => {
  if (!sessionStates.has(mockUser)) {
    sessionStates.set(mockUser, createSessionState(mockUser));
  }
  return sessionStates.get(mockUser);
};

export const getMockIdentityResponse = (mockUser) => {
  const state = getMockSessionState(mockUser);
  if (!state.user) {
    return {
      success: true,
      registered: false,
      lineUserId: 'mock-unregistered-id',
      displayName: 'Mock Unregistered'
    };
  }

  const user = clone(state.user);
  const calendarEvents = getMockCalendarEvents(mockUser);
  const ordersMap = {};
  state.orders.forEach((order) => {
    ordersMap[order.date] = true;
  });

  return {
    success: true,
    registered: true,
    user: {
      ...user,
      lineUserId: user.userId,
      displayName: user.name
    },
    calendar: {
      events: calendarEvents,
      announcements: getMockAnnouncements(),
      announcement: getMockAnnouncements()[0] || null
    },
    ordersMap,
    targetDate: null
  };
};

export const registerMockUser = (mockUser, pickupFloor) => {
  const state = getMockSessionState(mockUser);
  if (state.user) return clone(state.user);

  state.user = {
    userId: 'mock-unregistered-id',
    name: 'Mock Unregistered',
    floor: pickupFloor,
    defaultFloor: pickupFloor,
    balance: 0,
    role: 'User'
  };
  state.orders = [];
  return clone(state.user);
};

export const getMockMenu = () => ([
  {
    item_id: 'MOCK-001',
    item_name: 'Mock Bento',
    price: 80,
    note: 'local mock fixture',
    image_url: ''
  },
  {
    item_id: 'MOCK-002',
    item_name: 'Mock Vegetarian Bento',
    price: 95,
    note: 'local mock fixture',
    image_url: ''
  }
]);

export const getMockCalendarEvents = (mockUser) => {
  const state = getMockSessionState(mockUser);
  const primaryDate = getPrimaryDate();
  const dates = [primaryDate, addDays(primaryDate, 2), addDays(primaryDate, 4)];

  return dates.reduce((events, date, index) => {
    const vendor = state.vendors[date] || MOCK_VENDORS[index % MOCK_VENDORS.length];
    events[date] = {
      order_date: date,
      vendor,
      mode: 'A',
      deadline: '2099-01-01T02:00:00.000Z',
      isExpired: false,
      likeCount: index,
      isUserLiked: state.likes.has(date),
      lunarLabel: null
    };
    return events;
  }, {});
};

export const getMockAnnouncements = () => ([
  {
    id: 'mock-announcement-1',
    title: 'Mock mode is local only',
    start_date: '2099-01-01',
    content: 'Orders and balance changes in DEV mock mode stay in browser memory.'
  }
]);

export const getMockOrderPageData = (mockUser, targetDate) => {
  const state = getMockSessionState(mockUser);
  const date = String(targetDate || getPrimaryDate());
  const order = state.orders.find((candidate) => candidate.date === date);
  const event = getMockCalendarEvents(mockUser)[date];

  return {
    success: true,
    setting: {
      order_date: date,
      vendor: event?.vendor || MOCK_VENDORS[0],
      mode: 'A'
    },
    deadline: {
      now: new Date().toISOString(),
      deadline: '2099-01-01T02:00:00.000Z',
      isExpired: false
    },
    menu: getMockMenu(),
    myOrder: {
      orderId: order?.orderId || '',
      items: order?.items || [],
      note: order?.note || ''
    }
  };
};

export const getMockOrdersMap = (mockUser) => {
  const state = getMockSessionState(mockUser);
  return state.orders.reduce((ordersMap, order) => {
    ordersMap[order.date] = true;
    return ordersMap;
  }, {});
};

export const getMockAdminOrders = (targetDate) => {
  const date = String(targetDate || getPrimaryDate());
  return [
    {
      order_id: 'MOCK-ADMIN-ORDER',
      name: 'Mock Admin',
      pickup_floor: '9樓',
      item_id: 'MOCK-001',
      item_name: 'Mock Bento',
      quantity: 2,
      unit_price: 80,
      subtotal: 160,
      created_at: '2099-01-01 09:00:00',
      note: 'mock fixture',
      date
    },
    {
      order_id: 'MOCK-USER-ORDER',
      name: 'Mock User',
      pickup_floor: '1樓',
      item_id: 'MOCK-002',
      item_name: 'Mock Vegetarian Bento',
      quantity: 1,
      unit_price: 95,
      subtotal: 95,
      created_at: '2099-01-01 09:05:00',
      note: '',
      date
    }
  ];
};

export const getMockMembers = (mockUser) => {
  const state = getMockSessionState(mockUser);
  return state.members.map(clone);
};

export const getMockBalanceHistory = (mockUser, year, month) => {
  const state = getMockSessionState(mockUser);
  const value = Number(state.user?.balance || 0);
  return {
    success: true,
    ok: true,
    year: Number(year),
    month: Number(month),
    openingBalance: value + 80,
    totalCredit: 0,
    totalDebit: 80,
    closingBalance: value,
    transactions: [{
      id: 'MOCK-TXN-001',
      transactionId: 'MOCK-TXN-001',
      type: 'ORDER',
      referenceId: 'MOCK-USER-ORDER',
      description: 'mock fixture order',
      note: 'mock fixture order',
      occurredAt: '2099-01-01 09:00',
      timestamp: '2099-01-01 09:00',
      amount: -80,
      changeAmount: -80,
      balanceAfter: value,
      balance: value
    }]
  };
};
