const MOCK_VENDORS = Object.freeze(['Mock Bento A', 'Mock Bento B']);

export const MOCK_VENDOR_FIXTURES = Object.freeze([
  Object.freeze({
    id: 'mock-vendor-a',
    name: 'Mock Bento A',
    description: 'Local mock vendor fixture.',
    phone: '02-0000-0001',
    address: '1樓',
    website_url: 'https://example.com/mock-bento-a',
    menu_source_url: 'https://example.com/mock-bento-a/menu',
    menu_image_url: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
    menu_updated_at: '2099-01-01',
    enabled: true
  }),
  Object.freeze({
    id: 'mock-vendor-b',
    name: 'Mock Bento B',
    description: 'Second local mock vendor fixture.',
    phone: '',
    address: '',
    website_url: '',
    menu_source_url: 'https://example.com/mock-bento-b/menu',
    menu_image_url: '',
    menu_updated_at: null,
    enabled: true
  })
]);

const MOCK_USER_FIXTURES = Object.freeze({
  user: Object.freeze({
    userId: 'mock-user-id',
    employeeId: 'MCKUSR',
    name: 'Mock User',
    floor: '1樓',
    defaultFloor: '1樓',
    balance: 500,
    role: 'User',
    authSource: 'LINE',
    identityState: 'VERIFIED',
    verificationStatus: 'VERIFIED'
  }),
  admin: Object.freeze({
    userId: 'mock-admin-id',
    employeeId: 'MCKADM',
    name: 'Mock Admin',
    floor: '9樓',
    defaultFloor: '9樓',
    balance: 1200,
    role: 'Admin',
    authSource: 'LINE',
    identityState: 'VERIFIED',
    verificationStatus: 'VERIFIED'
  }),
  vendor: Object.freeze({
    userId: 'mock-vendor-principal-id',
    employeeId: null,
    name: 'Local mock vendor',
    floor: null,
    defaultFloor: null,
    balance: null,
    role: 'Vendor',
    authSource: 'LINE',
    authMode: 'line',
    identityState: 'VERIFIED',
    registered: true,
    lineBound: true,
    verificationStatus: 'VERIFIED'
  }),
  'admin-unverified': Object.freeze({
    userId: 'mock-admin-unverified-id',
    employeeId: 'MCKUNV',
    name: 'Mock Admin Pending Legacy Status',
    floor: '9樓',
    defaultFloor: '9樓',
    balance: 1200,
    role: 'Admin',
    authSource: 'LINE',
    authMode: 'line',
    identityState: 'VERIFIED',
    registered: true,
    verificationStatus: 'UNVERIFIED'
  }),
  'admin-unbound': Object.freeze({
    userId: 'mock-admin-unbound-id',
    employeeId: null,
    name: 'Mock Unbound Admin',
    floor: '1樓',
    defaultFloor: '1樓',
    balance: 0,
    role: 'Admin',
    authSource: 'LINE',
    authMode: 'line',
    identityState: 'EMPLOYEE_BIND_REQUIRED',
    registered: false,
    verificationStatus: 'UNVERIFIED'
  }),
  'guest-admin': Object.freeze({
    userId: 'mock-guest-admin-id',
    employeeId: 'MCKGST',
    name: 'Mock Guest Admin Row',
    floor: '1樓',
    defaultFloor: '1樓',
    balance: 0,
    role: 'Admin',
    authSource: 'EMPLOYEE_GUEST',
    authMode: 'employee_guest',
    identityState: 'PENDING_VERIFICATION',
    registered: false,
    verificationStatus: 'UNVERIFIED'
  }),
  'proxy-admin': Object.freeze({
    userId: 'mock-proxy-admin-id',
    employeeId: 'MCKPRX',
    name: 'Mock Proxy Admin',
    floor: '1樓',
    defaultFloor: '1樓',
    balance: 700,
    role: 'ProxyAdmin',
    authSource: 'LINE',
    identityState: 'VERIFIED',
    verificationStatus: 'VERIFIED'
  }),
  unregistered: null
});

const MOCK_INVALID_REPAIR_MEMBERS = Object.freeze([
  Object.freeze({
    userId: 'mock-repair-source-id',
    employeeId: 'MCKSRC',
    name: 'Mock Source Name',
    floor: '1樓',
    defaultFloor: '1樓',
    balance: 0,
    role: 'User',
    authSource: 'EMPLOYEE',
    authMode: 'employee',
    active: true,
    invalidReason: null,
    lineBound: false,
    updatedAt: '2026-10-19T09:00:00.000Z'
  }),
  Object.freeze({
    userId: 'mock-repair-target-id',
    employeeId: 'MCKTGT',
    name: 'Mock Target Name',
    floor: '9樓',
    defaultFloor: '9樓',
    balance: 350,
    role: 'User',
    authSource: 'LINE',
    authMode: 'line',
    active: true,
    invalidReason: null,
    lineBound: true,
    updatedAt: '2026-10-19T09:00:00.000Z'
  }),
  Object.freeze({
    userId: 'mock-disabled-synthetic-id',
    employeeId: 'MCKDIS',
    name: 'Mock Disabled Account',
    floor: '1樓',
    defaultFloor: '1樓',
    balance: 0,
    role: 'User',
    authSource: 'LINE',
    authMode: 'line',
    active: false,
    invalidReason: null,
    lineBound: false,
    updatedAt: '2026-10-19T09:00:00.000Z'
  })
]);

const sessionStates = new Map();
const mockVendorPaymentStore = [];

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
    vendorMetadata: MOCK_VENDOR_FIXTURES.map(clone),
    vendorPayments: mockVendorPaymentStore,
    announcementPreferences: {},
    members: Object.values(MOCK_USER_FIXTURES)
      .filter(Boolean)
      .map(clone)
      .concat(MOCK_INVALID_REPAIR_MEMBERS.map(clone)),
    invalidEmployeeRepairs: []
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
  const authMode = user.authMode
    || (user.authSource === 'EMPLOYEE_GUEST' ? 'employee_guest' : 'line');
  const registered = user.registered !== undefined
    ? Boolean(user.registered)
    : Boolean(authMode === 'line' && user.employeeId);
  const calendarEvents = getMockCalendarEvents(mockUser);
  const ordersMap = {};
  state.orders.forEach((order) => {
    ordersMap[order.date] = true;
  });

  return {
    success: true,
    registered,
    authMode,
    user: {
      ...user,
      lineUserId: authMode === 'line' ? user.userId : null,
      displayName: user.name
    },
    calendar: {
      events: calendarEvents,
      announcements: getMockAnnouncements(mockUser),
      announcement: getMockAnnouncements(mockUser)[0] || null
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
    role: 'User',
    authSource: 'LINE',
    identityState: 'VERIFIED',
    verificationStatus: 'VERIFIED'
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

const normalizeMockVendorName = (value) => (
  String(value || '').trim() === '合十' ? '禾拾' : String(value || '').trim()
);

export const getMockVendors = (mockUser) => {
  const state = getMockSessionState(mockUser);
  const events = Object.values(getMockCalendarEvents(mockUser));
  return state.vendorMetadata.map((vendor) => {
    const name = normalizeMockVendorName(vendor.name);
    const recentGroups = events
      .filter((event) => normalizeMockVendorName(event.vendor) === name)
      .map((event) => ({
        order_date: event.order_date,
        mode: event.mode,
        deadline: event.deadline,
        is_expired: Boolean(event.isExpired)
      }));
    return {
      ...clone(vendor),
      name,
      is_open_for_ordering: Boolean(vendor.enabled && recentGroups.some((group) => !group.is_expired)),
      recent_groups: recentGroups
    };
  });
};

export const getMockVendor = (mockUser, vendorId) => (
  getMockVendors(mockUser).find((vendor) => vendor.id === String(vendorId || '').trim()) || null
);

export const updateMockVendor = (mockUser, vendorId, patch = {}) => {
  const state = getMockSessionState(mockUser);
  const vendor = state.vendorMetadata.find((candidate) => candidate.id === String(vendorId || '').trim());
  if (!vendor) return null;
  Object.keys(patch).forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(vendor, field)) vendor[field] = patch[field];
  });
  return getMockVendor(mockUser, vendor.id);
};

// This fixture is browser-memory only. It never calls a Worker, LINE login,
// bank service, or persistent database.
export const getMockVendorOperations = (mockUser, { month, vendorId = null } = {}) => {
  const state = getMockSessionState(mockUser);
  const isVendor = state.user?.role === 'Vendor';
  const vendors = getMockVendors(mockUser).filter((vendor) => (
    isVendor ? vendor.id === 'mock-vendor-a' : !vendorId || vendor.id === vendorId
  ));
  const currentDate = getPrimaryDate();
  const currentMonth = currentDate.slice(0, 7);
  const selectedMonth = String(month || currentMonth);
  const days = [];
  for (const vendor of vendors) {
    const serviceDates = new Set();
    if (selectedMonth === currentMonth) serviceDates.add(currentDate);
    state.vendorPayments
      .filter((payment) => payment.vendorId === vendor.id)
      .forEach((payment) => payment.allocations.forEach((allocation) => {
        if (allocation.serviceDate.startsWith(`${selectedMonth}-`)) serviceDates.add(allocation.serviceDate);
      }));
    for (const serviceDate of [...serviceDates].sort().reverse()) {
      const transfers = state.vendorPayments
        .filter((payment) => payment.vendorId === vendor.id)
        .flatMap((payment) => payment.allocations
          .filter((allocation) => allocation.serviceDate === serviceDate)
          .map((allocation) => ({
            paymentId: payment.paymentId,
            allocationId: allocation.allocationId,
            paymentAmountTwd: payment.amountTwd,
            unallocatedAmountTwd: payment.status === 'REVERSED' ? 0 : Math.max(0, payment.amountTwd - payment.allocations
              .reduce((sum, item) => sum + item.amountTwd + Number(item.adjustmentTwd || 0), 0)),
            transferredOn: payment.transferredOn,
            allocatedAmountTwd: allocation.amountTwd + Number(allocation.adjustmentTwd || 0),
            isPrimaryTransferRow: allocation.serviceDate === payment.allocations
              .map((item) => item.serviceDate).sort()[0],
            status: payment.status,
            disputeReason: payment.disputeReason || null,
            resolution: payment.resolution || null,
            reversalReason: payment.reversalReason || null
          })));
      const estimate = vendor.id === 'mock-vendor-a'
        ? { orderCount: 3, portionCount: 4, amountTwd: 320,
          items: [{ name: 'Mock Bento', variantKey: '', quantity: 4, amountTwd: 320 }] }
        : { orderCount: 2, portionCount: 2, amountTwd: 160,
          items: [{ name: 'Mock Noodle', variantKey: '', quantity: 2, amountTwd: 160 }] };
      const amountTwd = serviceDate === currentDate ? estimate.amountTwd : 0;
      const registeredTransferTwd = transfers.reduce((sum, transfer) => sum + transfer.allocatedAmountTwd, 0);
      days.push({
        serviceDate,
        vendorId: vendor.id,
        vendorName: vendor.name,
        cutoffAt: `${serviceDate}T02:00:00.000Z`,
        cutoffPassed: false,
        source: 'MOCK',
        revision: 0,
        changeReason: null,
        orderCount: serviceDate === currentDate ? estimate.orderCount : 0,
        portionCount: serviceDate === currentDate ? estimate.portionCount : 0,
        amountTwd,
        items: serviceDate === currentDate ? estimate.items : [],
        settlement: {
          receivableTwd: amountTwd,
          registeredTransferTwd,
          unregisteredDifferenceTwd: Math.max(0, amountTwd - registeredTransferTwd),
          overAllocatedTwd: Math.max(0, registeredTransferTwd - amountTwd),
          pendingConfirmationTwd: transfers.filter((entry) => entry.status === 'REGISTERED')
            .reduce((sum, entry) => sum + entry.allocatedAmountTwd, 0),
          confirmedTwd: transfers.filter((entry) => ['ACKNOWLEDGED', 'RESOLVED'].includes(entry.status))
            .reduce((sum, entry) => sum + entry.allocatedAmountTwd, 0),
          disputedTwd: transfers.filter((entry) => entry.status === 'DISPUTED')
            .reduce((sum, entry) => sum + entry.allocatedAmountTwd, 0),
          transfers
        }
      });
    }
  }
  return {
    success: true,
    month: selectedMonth,
    ...(isVendor ? {} : { vendor: vendors[0] ? { id: vendors[0].id, name: vendors[0].name } : null }),
    vendors: vendors.map(({ id, name }) => ({ id, name })),
    days
  };
};

export const recordMockVendorPayment = (mockUser, payload = {}) => {
  const state = getMockSessionState(mockUser);
  if (payload.actualTransferDone !== true || payload.detailsReviewed !== true) {
    return { error: 'PAYMENT_CONFIRMATION_REQUIRED' };
  }
  const existing = state.vendorPayments.find((payment) => (
    payment.createdByMockUser === mockUser
      && payment.idempotencyKey === payload.idempotencyKey
  ));
  if (existing) return existing.requestHash === JSON.stringify(payload)
    ? { paymentId: existing.paymentId, replayed: true }
    : { error: 'IDEMPOTENCY_KEY_REUSED' };
  const payment = {
    paymentId: `mock-payment-${state.vendorPayments.length + 1}`,
    createdByMockUser: mockUser,
    vendorId: String(payload.vendorId || ''),
    amountTwd: Number(payload.amountTwd),
    transferredOn: String(payload.transferredOn || ''),
    idempotencyKey: String(payload.idempotencyKey || ''),
    requestHash: JSON.stringify(payload),
    status: 'REGISTERED',
    disputeReason: '',
    resolution: '',
    allocations: (Array.isArray(payload.allocations) ? payload.allocations : []).map((entry, index) => ({
      allocationId: `mock-allocation-${state.vendorPayments.length + 1}-${index + 1}`,
      serviceDate: String(entry.serviceDate || ''),
      amountTwd: Number(entry.amountTwd),
      adjustmentTwd: 0
    }))
  };
  state.vendorPayments.push(payment);
  return { paymentId: payment.paymentId, replayed: false };
};

export const reverseMockVendorPayment = (mockUser, paymentId, reason, confirmed) => {
  const state = getMockSessionState(mockUser);
  const authMode = state.user?.authMode
    || (state.user?.authSource === 'EMPLOYEE_GUEST' ? 'employee_guest' : 'line');
  if (state.user?.role !== 'Admin' || authMode !== 'line' || state.user?.registered === false) {
    return { error: 'ADMIN_LINE_AUTH_REQUIRED' };
  }
  const payment = state.vendorPayments.find((entry) => entry.paymentId === paymentId);
  if (!payment) return { error: 'PAYMENT_NOT_FOUND' };
  if (payment.status === 'REVERSED') return { error: 'PAYMENT_ALREADY_REVERSED' };
  if (payment.status === 'DISPUTED') return { error: 'PAYMENT_DISPUTE_MUST_BE_RESOLVED' };
  if (confirmed !== true) return { error: 'PAYMENT_REVERSAL_CONFIRMATION_REQUIRED' };
  const normalizedReason = String(reason || '').trim();
  if (!normalizedReason || normalizedReason.length > 500) return { error: 'REVERSAL_REASON_REQUIRED' };
  for (const allocation of payment.allocations) {
    allocation.adjustmentTwd = -allocation.amountTwd;
  }
  payment.status = 'REVERSED';
  payment.reversalReason = normalizedReason;
  return { paymentId, status: payment.status };
};

export const updateMockVendorPayment = (mockUser, paymentId, eventType, value = '') => {
  const state = getMockSessionState(mockUser);
  const payment = state.vendorPayments.find((entry) => entry.paymentId === paymentId);
  if (!payment) return { error: 'PAYMENT_NOT_FOUND' };
  if (eventType === 'RESOLVED') {
    if (payment.status !== 'DISPUTED') return { error: 'PAYMENT_NOT_DISPUTED' };
    payment.status = 'RESOLVED';
    payment.resolution = value;
  } else {
    if (state.user?.role !== 'Vendor' || payment.vendorId !== 'mock-vendor-a') return { error: 'PAYMENT_NOT_FOUND' };
    if (payment.status !== 'REGISTERED') return { error: 'PAYMENT_RESPONSE_ALREADY_RECORDED' };
    payment.status = eventType;
    if (eventType === 'DISPUTED') payment.disputeReason = value;
  }
  return { paymentId, status: payment.status };
};

export const adjustMockVendorAllocation = (mockUser, allocationId, deltaTwd) => {
  const state = getMockSessionState(mockUser);
  const allocation = state.vendorPayments.flatMap((payment) => payment.allocations)
    .find((entry) => entry.allocationId === allocationId);
  if (!allocation) return { error: 'ALLOCATION_NOT_FOUND' };
  if (allocation.amountTwd + Number(allocation.adjustmentTwd || 0) + deltaTwd < 0) {
    return { error: 'VENDOR_ALLOCATION_ADJUSTMENT_INVALID' };
  }
  allocation.adjustmentTwd = Number(allocation.adjustmentTwd || 0) + deltaTwd;
  return { allocationId, deltaTwd };
};

export const getMockAnnouncements = (mockUser) => {
  const state = getMockSessionState(mockUser);
  const today = new Date().toISOString().slice(0, 10);
  const fixtures = [
    {
      id: 'mock-announcement-2',
      title: 'Mock 新公告二',
      content: '此公告用來驗證多筆公告會依序顯示。',
      start_date: '2026-10-03'
    },
    {
      id: 'mock-announcement-1',
      title: 'Mock 新公告一',
      content: '此為本機模擬公告，不含真實使用者資料。',
      start_date: '2026-10-02'
    },
    {
      id: 'mock-announcement-legacy',
      title: 'Mock 既有公告',
      content: '既有公告保留在收件匣，但不會因功能上線而自動彈出。',
      start_date: '2026-09-30',
      legacy: true
    }
  ];
  return fixtures.map((fixture) => {
    const preference = state.announcementPreferences[fixture.id] || {};
    return {
      ...fixture,
      start_date: fixture.start_date,
      end_date: '2099-01-01',
      images: [],
      readAt: preference.readAt || null,
      dismissAutoPopupAt: preference.dismissAutoPopupAt || null,
      shouldAutoPopup: !fixture.legacy
        && today >= '2026-01-01'
        && !preference.dismissAutoPopupAt
    };
  });
};

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
      order_id: 'MOCK-ISSUE-103-E-BASE-1',
      name: 'Mock Admin',
      vendor: 'Mock Bento A',
      pickup_floor: '1樓',
      item_id: 'MOCK-E-BASE',
      item_name: '風味餐',
      display_item_name: 'E.風味餐',
      item_identity_key: 'mock-vendor-a:E:BASE',
      item_vendor: 'Mock Bento A',
      item_variant_key: 'BASE',
      item_name_resolved: true,
      quantity: 2,
      unit_price: 120,
      subtotal: 240,
      created_at: '2099-01-01 09:00:00',
      note: 'mock fixture',
      date
    },
    {
      order_id: 'MOCK-ISSUE-103-E-BASE-2',
      name: 'Mock User',
      vendor: 'Mock Bento A',
      pickup_floor: '9樓',
      item_id: 'MOCK-E-BASE',
      item_name: 'E 風味餐',
      display_item_name: 'E.風味餐',
      item_identity_key: 'mock-vendor-a:E:BASE',
      item_vendor: 'Mock Bento A',
      item_variant_key: 'BASE',
      item_name_resolved: true,
      quantity: 1,
      unit_price: 120,
      subtotal: 120,
      created_at: '2099-01-01 09:05:00',
      note: '',
      date
    },
    {
      order_id: 'MOCK-ISSUE-103-S-BASE',
      name: 'Mock User',
      vendor: 'Mock Bento A',
      pickup_floor: '1樓',
      item_id: 'MOCK-S-BASE',
      item_name: '小而美',
      display_item_name: 'S.小而美',
      item_identity_key: 'mock-vendor-a:S:BASE',
      item_vendor: 'Mock Bento A',
      item_variant_key: 'BASE',
      item_name_resolved: true,
      quantity: 1,
      unit_price: 100,
      subtotal: 100,
      created_at: '2099-01-01 09:10:00',
      note: '',
      date
    },
    {
      order_id: 'MOCK-ISSUE-103-C-HALF',
      name: 'Mock Admin',
      vendor: 'Mock Bento B',
      pickup_floor: '9樓',
      item_id: 'MOCK-C-HALF',
      item_name: '特餐(半飯)',
      display_item_name: 'C.特餐(半飯)',
      item_identity_key: 'mock-vendor-b:C:HALF',
      item_vendor: 'Mock Bento B',
      item_variant_key: 'HALF',
      item_name_resolved: true,
      quantity: 1,
      unit_price: 150,
      subtotal: 150,
      created_at: '2099-01-01 09:05:00',
      note: '',
      date
    }
  ];
};

export const getMockOrderStatistics = (period = 'all') => {
  const endDate = getPrimaryDate();
  const startDate = period === 'year'
    ? `${endDate.slice(0, 4)}-01-01`
    : period === 'month'
      ? `${endDate.slice(0, 7)}-01`
      : null;
  const items = [
    {
      name: '蕃茄鷹豆泥',
      identityKey: 'mock-vendor-a:hummus:BASE',
      vendor: 'Mock Bento A',
      variantKey: 'BASE',
      portions: 3
    },
    {
      name: 'C.特餐',
      identityKey: 'mock-vendor-a:daily-special:BASE',
      vendor: 'Mock Bento A',
      variantKey: 'BASE',
      portions: 3
    },
    {
      name: 'A.風味便當',
      identityKey: 'mock-vendor-b:flavor-bento:BASE',
      vendor: 'Mock Bento B',
      variantKey: 'BASE',
      portions: 1
    }
  ];
  return {
    period,
    startDate,
    endDate,
    totalPortions: 7,
    totalOrderDays: 2,
    totalMealTypes: items.length,
    vendors: [
      { name: 'Mock Bento A', portions: 6 },
      { name: 'Mock Bento B', portions: 1 }
    ],
    items
  };
};

export const getMockMembers = (mockUser, { includeInvalid = false } = {}) => {
  const state = getMockSessionState(mockUser);
  return state.members
    .filter((member) => includeInvalid || (member.active !== false && !member.invalidReason))
    .map((member) => ({
      ...clone(member),
      active: member.active !== false,
      lineBound: Boolean(member.lineBound ?? member.authSource === 'LINE')
    }));
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
