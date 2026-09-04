import React, { useState, useEffect, useMemo, useRef } from 'react';
import liff from '@line/liff';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';
import { formatDateInput, getTaipeiYearMonth, shiftYearMonth } from './dateUtils';
import { gasGet, gasPost } from './api/gasApi';
import { hasPermission } from './auth/permissions';
import ViewAsBanner from './components/ViewAsBanner';
import CalendarManagement from './features/calendar/CalendarManagement';
import OrderPage from './features/orders/OrderPage';
import AdminOrderSummary from './features/admin/AdminOrderSummary';
import MemberBalanceManagement from './features/balances/MemberBalanceManagement';
import { formatSignedAmount, formatBalanceAmount } from './features/balances/formatters';

// 自動根據目前環境讀取對應的變數
const LIFF_ID = import.meta.env.VITE_LIFF_ID;

const AUTH_STATES = Object.freeze({
  AUTH_LOADING: 'AUTH_LOADING',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_FAILED: 'AUTH_FAILED',
  UNREGISTERED: 'UNREGISTERED',
  REGISTERED: 'REGISTERED'
});

const redactAuthSecrets = (value) => String(value || 'Unknown error')
  .replace(/(access[_-]?token|id[_-]?token|authorization)\s*[:=]?\s*[^\s,;]+/gi, '$1=[REDACTED]')
  .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]');

const logAuthDiagnostic = (message) => {
  if (import.meta.env.DEV) {
    console.info(`[AUTH] ${message}`);
  }
};

if (!LIFF_ID) {
  throw new Error('Missing VITE_LIFF_ID');
}

const showPopup = (options) => Swal.fire({
  confirmButtonText: '確定',
  confirmButtonColor: '#2C4A3E',
  customClass: {
    popup: 'rounded-3xl',
    confirmButton: 'rounded-xl'
  },
  ...options
});

const parseMenuItemName = (itemName = '') => {
  const fullName = String(itemName).trim();
  const match = fullName.match(/^(.*?)\s*(?:\(([^()]*)\)|（([^（）]*)）)\s*$/);

  if (!match || !match[1].trim()) {
    return { baseName: fullName, variant: '' };
  }

  return {
    baseName: match[1].trim(),
    variant: (match[2] ?? match[3] ?? '').trim()
  };
};

const getConfiguredVendor = (event) => {
  const vendor = event?.vendor;
  return vendor === undefined || vendor === null ? '蔡老師' : vendor;
};

export default function App() {
  const [viewMode, setViewMode] = useState('calendar');
  const [calendarEvents, setCalendarEvents] = useState({});
  const [userOrdersMap, setUserOrdersMap] = useState({});
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const [lineUserId, setLineUserId] = useState('');
  const [authUser, setAuthUser] = useState(null);
  const [viewAsUser, setViewAsUser] = useState(null);
  const [userBalance, setUserBalance] = useState(0);
  const [defaultFloor, setDefaultFloor] = useState('');
  const [authState, setAuthState] = useState(AUTH_STATES.AUTH_LOADING);
  const [authStage, setAuthStage] = useState(AUTH_STATES.AUTH_LOADING);
  const [authError, setAuthError] = useState('');
  const [registrationDisplayName, setRegistrationDisplayName] = useState('');
  const [registrationFloor, setRegistrationFloor] = useState('1樓');
  const [registrationLoading, setRegistrationLoading] = useState(false);
  const authInitInFlightRef = useRef(false);

  const [selectedDate, setSelectedDate] = useState(null);
  const [activeOrderId, setActiveOrderId] = useState('');
  const [setting, setSetting] = useState(null);
  const [deadline, setDeadline] = useState(null);
  const [menu, setMenu] = useState([]);
  const [imageLoadErrors, setImageLoadErrors] = useState({});
  const [name, setName] = useState('');
  const [floor, setFloor] = useState('1樓');
  const [orderNote, setOrderNote] = useState('');
  const [orderItems, setOrderItems] = useState({});
  const [hasExistingOrder, setHasExistingOrder] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [selectedOrderDate, setSelectedOrderDate] = useState(() => formatDateInput());
  const [adminSummary, setAdminSummary] = useState({
    usersSummary: [],
    todayOrders: [],
    requesterRole: 'User',
    targetDate: '',
    totalItems: 0,
    totalAmount: 0,
    items: [],
    pickupSummary: {}
  });
  const [adminSummaryLoading, setAdminSummaryLoading] = useState(false);
  const [adminSummaryError, setAdminSummaryError] = useState('');
  const adminSummaryRequestRef = useRef(0);
  const [adminSection, setAdminSection] = useState('orders');
  const [memberBalances, setMemberBalances] = useState([]);
  const [memberBalancesLoading, setMemberBalancesLoading] = useState(false);
  const [memberBalancesError, setMemberBalancesError] = useState('');
  const [memberBalancesLoaded, setMemberBalancesLoaded] = useState(false);
  const memberBalancesRequestRef = useRef(0);
  const [showViewAsModal, setShowViewAsModal] = useState(false);

  // 餘額歷史彈窗狀態
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyList, setHistoryList] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [selectedYear, setSelectedYear] = useState(() => getTaipeiYearMonth().year);
  const [selectedMonth, setSelectedMonth] = useState(() => getTaipeiYearMonth().month);
  const [historySummary, setHistorySummary] = useState({
    openingBalance: 0,
    totalCredit: 0,
    totalDebit: 0,
    closingBalance: 0
  });
  const historyRequestRef = useRef(0);
  const [selectedTopupUser, setSelectedTopupUser] = useState(null);
  const [topupAmount, setTopupAmount] = useState('');
  const [topupNote, setTopupNote] = useState('現金收款');
  const [topupLoading, setTopupLoading] = useState(false);

  // Admin 管理月曆彈窗狀態
  const [adminManageMode, setAdminManageMode] = useState(false);
  const [selectedAdminDate, setSelectedAdminDate] = useState(null);
  const [adminVendorChoice, setAdminVendorChoice] = useState('蔡老師');
  const [specialAdminDate, setSpecialAdminDate] = useState(formatDateInput(new Date()));
  const [specialAdminVendorChoice, setSpecialAdminVendorChoice] = useState('蔡老師');

  const isExpired = Boolean(deadline?.isExpired || deadline?.expired);

  const clearIdentityData = () => {
    adminSummaryRequestRef.current += 1;
    historyRequestRef.current += 1;
    memberBalancesRequestRef.current += 1;
    setLineUserId('');
    setAuthUser(null);
    setViewAsUser(null);
    setUserBalance(0);
    setDefaultFloor('');
    setRegistrationDisplayName('');
    setName('');
    setCalendarEvents({});
    setUserOrdersMap({});
    setSelectedDate(null);
    setActiveOrderId('');
    setSetting(null);
    setDeadline(null);
    setMenu([]);
    setImageLoadErrors({});
    setOrderItems({});
    setHasExistingOrder(false);
    setMessage('');
    setSelectedOrderDate(formatDateInput());
    setAdminSummary({
      usersSummary: [],
      todayOrders: [],
      requesterRole: 'User',
      targetDate: '',
      totalItems: 0,
      totalAmount: 0,
      items: [],
      pickupSummary: {}
    });
    setAdminSummaryLoading(false);
    setAdminSummaryError('');
    setAdminSection('orders');
    setMemberBalances([]);
    setMemberBalancesLoading(false);
    setMemberBalancesError('');
    setMemberBalancesLoaded(false);
    setShowViewAsModal(false);
    setAdminManageMode(false);
    setSelectedAdminDate(null);
    setSelectedTopupUser(null);
    setShowHistoryModal(false);
    setHistoryLoading(false);
    setHistoryList([]);
    setHistorySummary({ openingBalance: 0, totalCredit: 0, totalDebit: 0, closingBalance: 0 });
    setHistoryError('');
    setViewMode('calendar');
  };

  const failAuthentication = (stage, error) => {
    const safeMessage = redactAuthSecrets(error instanceof Error ? error.message : error);
    setAuthState(AUTH_STATES.AUTH_FAILED);
    setAuthStage(stage);
    setAuthError(`${stage}: ${safeMessage}`);
    clearIdentityData();
    console.error(`[AUTH] ${stage}: ${safeMessage}`);
  };

  const initLiffAndFetchData = async () => {
    if (authInitInFlightRef.current) {
      logAuthDiagnostic('LIFF_INIT_SKIPPED_IN_FLIGHT');
      return;
    }

    authInitInFlightRef.current = true;
    let currentStage = 'LIFF_INIT_START';
    setLoading(true);
    setAuthState(AUTH_STATES.AUTH_LOADING);
    setAuthStage(currentStage);
    setAuthError('');
    clearIdentityData();

    try {
      logAuthDiagnostic('LIFF_INIT_START');
      await liff.init({ liffId: LIFF_ID });
      currentStage = 'LIFF_INIT_SUCCESS';
      setAuthStage(currentStage);
      logAuthDiagnostic(currentStage);

      const isLoggedIn = liff.isLoggedIn();
      logAuthDiagnostic(`LIFF_IS_LOGGED_IN=${isLoggedIn}`);
      logAuthDiagnostic(`LIFF_IS_IN_CLIENT=${liff.isInClient()}`);
      if (!isLoggedIn) {
        setAuthState(AUTH_STATES.AUTH_REQUIRED);
        setAuthStage(AUTH_STATES.AUTH_REQUIRED);
        logAuthDiagnostic('AUTH_REQUIRED');
        liff.login();
        return;
      }

      currentStage = 'LIFF_ACCESS_TOKEN_READ';
      setAuthStage(currentStage);
      const accessToken = liff.getAccessToken();
      logAuthDiagnostic(`LIFF_ACCESS_TOKEN_PRESENT=${Boolean(accessToken)}`);
      if (!accessToken) {
        failAuthentication('LIFF_ACCESS_TOKEN_MISSING', 'LIFF accessToken 不存在');
        return;
      }

      currentStage = 'LIFF_PROFILE_START';
      setAuthStage(currentStage);
      try {
        await liff.getProfile();
        logAuthDiagnostic('LIFF_PROFILE_SUCCESS=true');
      } catch (profileError) {
        logAuthDiagnostic('LIFF_PROFILE_SUCCESS=false');
        failAuthentication('LIFF_PROFILE_FAILED', profileError);
        return;
      }

      currentStage = 'BACKEND_IDENTITY_VERIFY_START';
      setAuthStage(currentStage);
      const identity = await fetchUserInfo(accessToken);
      if (identity?.success && identity.registered && identity.user) {
        const canonicalUserId = identity.user.userId;
        setAuthState(AUTH_STATES.REGISTERED);
        setAuthStage('REGISTERED');
        setAuthError('');
        logAuthDiagnostic('BACKEND_IDENTITY_VERIFY_SUCCESS=true');
        logAuthDiagnostic('USER_REGISTERED=true');
        logAuthDiagnostic(`USER_ROLE=${identity.user.role || 'User'}`);
        setLineUserId(canonicalUserId);
        if (hasPermission(identity.user.role, 'viewAdminOrderSummary')) {
          prefetchAdminSummary(canonicalUserId);
        }
        fetchUserAllOrders(canonicalUserId);
        await fetchCalendarEvents(canonicalUserId);
      } else if (identity?.success && identity.registered === false) {
        setAuthState(AUTH_STATES.UNREGISTERED);
        setAuthStage('UNREGISTERED');
        setAuthError('');
        logAuthDiagnostic('BACKEND_IDENTITY_VERIFY_SUCCESS=true');
        logAuthDiagnostic('USER_REGISTERED=false');
      } else {
        logAuthDiagnostic('BACKEND_IDENTITY_VERIFY_SUCCESS=false');
        failAuthentication('BACKEND_IDENTITY_VERIFY_FAILED', identity?.message || 'backend 未回傳有效身份狀態');
      }
    } catch (err) {
      failAuthentication(currentStage, err);
    } finally {
      setLoading(false);
      authInitInFlightRef.current = false;
    }
  };

  useEffect(() => {
    initLiffAndFetchData();
  }, []);

  const loadAdminSummary = async (targetDate, targetUserId, shouldShowView) => {
    if (!targetUserId || !targetDate) return;

    const requestId = ++adminSummaryRequestRef.current;
    if (shouldShowView) setViewMode('admin');
    setAdminSummaryLoading(true);
    setAdminSummaryError('');
    setAdminSummary(prev => ({
      ...prev,
      targetDate,
      todayOrders: [],
      totalItems: 0,
      totalAmount: 0,
      items: [],
      pickupSummary: {}
    }));

    try {
      const accessToken = liff.getAccessToken();
      if (!accessToken) {
        setAdminSummaryError('目前無法驗證身份，請重新登入後再試。');
        return;
      }
      const res = await gasPost({
          action: 'getAdminSummary',
          accessToken,
          targetDate,
          includeMemberBalances: false
      });
      const data = await res.json();
      if (requestId !== adminSummaryRequestRef.current) return;

      if (data.success) {
        const nextOrders = data.todayOrders || [];
        const fallbackTotalItems = nextOrders.reduce((sum, order) => sum + Number(order.quantity || 0), 0);
        const fallbackTotalAmount = nextOrders.reduce((sum, order) => sum + Number(order.subtotal || 0), 0);
        setAdminSummary({
          usersSummary: data.usersSummary || [],
          todayOrders: nextOrders,
          requesterRole: data.requesterRole || authUser?.role || 'User',
          targetDate: data.targetDate || targetDate,
          totalItems: data.totalItems ?? fallbackTotalItems,
          totalAmount: data.totalAmount ?? fallbackTotalAmount,
          items: data.items || [],
          pickupSummary: data.pickupSummary || {}
        });
      } else {
        setAdminSummaryError('目前無法取得指定日期的訂單總覽，請稍後再試。');
      }
    } catch {
      if (requestId === adminSummaryRequestRef.current) {
        setAdminSummaryError('目前無法取得指定日期的訂單總覽，請稍後再試。');
      }
    } finally {
      if (requestId === adminSummaryRequestRef.current) setAdminSummaryLoading(false);
    }
  };

  const prefetchAdminSummary = async (uId) => {
    const targetUserId = uId || authUserId;
    if (!targetUserId) return;
    await loadAdminSummary(selectedOrderDate, targetUserId, false);
  };

  const loadMemberBalances = async (force = false) => {
    const visibleRole = viewAsUser?.role || authUser?.role;
    if (!authUser?.userId || !hasPermission(visibleRole, 'viewMemberBalances')) return;
    if (!force && memberBalancesLoaded) return;

    const requestId = ++memberBalancesRequestRef.current;
    setMemberBalancesLoading(true);
    setMemberBalancesError('');

    try {
      const accessToken = liff.getAccessToken();
      if (!accessToken) {
        setMemberBalancesError('目前無法驗證身份，請重新登入後再試。');
        return;
      }
      const res = await gasPost({
          action: 'getMemberBalances',
          accessToken
      });
      const data = await res.json();
      if (requestId !== memberBalancesRequestRef.current) return;

      if (data.success) {
        setMemberBalances(data.members || data.users || []);
        setMemberBalancesLoaded(true);
      } else {
        setMemberBalancesError('目前無法取得成員餘額，請稍後再試。');
      }
    } catch {
      if (requestId === memberBalancesRequestRef.current) {
        setMemberBalancesError('目前無法取得成員餘額，請稍後再試。');
      }
    } finally {
      if (requestId === memberBalancesRequestRef.current) setMemberBalancesLoading(false);
    }
  };

  const fetchUserInfo = async (accessToken) => {
    try {
      if (!accessToken) {
        return { success: false, message: 'LIFF accessToken 不存在' };
      }

      const res = await gasPost({
          action: 'getUserInfo',
          accessToken
      });
      if (!res.ok) {
        return { success: false, message: `backend HTTP ${res.status}` };
      }
      const data = await res.json();
      if (data.success && data.registered && data.user) {
        const nextUser = {
          ...data.user,
          userId: data.user.userId,
          name: data.user.name || '',
          floor: data.user.defaultFloor || data.user.floor || '',
          defaultFloor: data.user.defaultFloor || data.user.floor || '',
          balance: Number(data.user.balance || 0),
          role: data.user.role || 'User'
        };
        setAuthUser(nextUser);
        setViewAsUser(null);
        setLineUserId(nextUser.userId);
        setUserBalance(nextUser.balance);
        setName(nextUser.name);
        setDefaultFloor(nextUser.defaultFloor);
        setFloor(nextUser.defaultFloor);
        return data;
      }

      if (data.success && data.registered === false) {
        setLineUserId(data.lineUserId || '');
        setRegistrationDisplayName(data.displayName || '');
        setRegistrationFloor('1樓');
        setAuthUser(null);
        setViewAsUser(null);
        setName('');
        setDefaultFloor('');
        setUserBalance(0);
        return data;
      }

      return { success: false, message: data.message || 'backend 未回傳有效身份狀態' };
    } catch (err) {
      const safeMessage = redactAuthSecrets(err instanceof Error ? err.message : err);
      logAuthDiagnostic(`BACKEND_IDENTITY_VERIFY_SUCCESS=false stage=BACKEND_IDENTITY_VERIFY_REQUEST error=${safeMessage}`);
      return { success: false, message: safeMessage };
    }
  };

  const handleRegister = async () => {
    if (registrationLoading || authState !== AUTH_STATES.UNREGISTERED) return;

    const accessToken = liff.getAccessToken();
    if (!accessToken) {
      failAuthentication('REGISTER_ACCESS_TOKEN_MISSING', 'LIFF accessToken 不存在');
      await showPopup({ icon: 'error', title: '身份驗證失敗', text: '目前無法取得 LINE 身份驗證，請重新驗證。' });
      return;
    }

    setRegistrationLoading(true);
    setLoading(true);
    setAuthStage('REGISTER_REQUEST');
    logAuthDiagnostic('REGISTER_REQUEST_START');
    try {
      const res = await gasPost({
          action: 'registerUser',
          accessToken,
          pickupFloor: registrationFloor
      });
      if (!res.ok) {
        throw new Error(`backend HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data.success) {
        await showPopup({ icon: 'error', title: '註冊失敗', text: data.message || '目前無法完成註冊，請稍後再試。' });
        return;
      }

      // Backend 會回傳 canonical row；這裡再重新取得一次，確保後續狀態來自 Users。
      const canonicalAccessToken = liff.getAccessToken();
      logAuthDiagnostic(`LIFF_ACCESS_TOKEN_PRESENT=${Boolean(canonicalAccessToken)}`);
      const identity = await fetchUserInfo(canonicalAccessToken);
      if (!identity?.success || !identity.registered || !identity.user) {
        failAuthentication('REGISTRATION_CANONICAL_READBACK_FAILED', identity?.message || '註冊後無法取得 canonical Users row');
        await showPopup({ icon: 'error', title: '註冊驗證失敗', text: '註冊完成後無法重新取得帳戶資料，請聯絡管理員。' });
        return;
      }

      const canonicalUserId = identity.user.userId;
      setAuthState(AUTH_STATES.REGISTERED);
      setAuthStage('REGISTERED');
      setAuthError('');
      logAuthDiagnostic('BACKEND_IDENTITY_VERIFY_SUCCESS=true');
      logAuthDiagnostic('USER_REGISTERED=true');
      logAuthDiagnostic(`USER_ROLE=${identity.user.role || 'User'}`);
      setLineUserId(canonicalUserId);
      if (hasPermission(identity.user.role, 'viewAdminOrderSummary')) {
        prefetchAdminSummary(canonicalUserId);
      }
      fetchUserAllOrders(canonicalUserId);
      await fetchCalendarEvents(canonicalUserId);
    } catch (err) {
      failAuthentication('REGISTER_REQUEST_FAILED', err);
      await showPopup({ icon: 'error', title: '連線失敗', text: '目前無法完成註冊，請稍後再試。' });
    } finally {
      setRegistrationLoading(false);
      setLoading(false);
    }
  };

  const fetchCalendarEvents = async (uId) => {
    const targetId = uId || authUserId;
    if (!targetId) return;
    try {
      const res = await gasGet(`?action=getCalendarEvents&userId=${targetId}&t=${Date.now()}`);
      const data = await res.json();
      if (data.success) {
        setCalendarEvents(data.events || {});
      }
    } catch (err) {
      console.error("無法讀取月曆資料", err);
    }
  };

  const fetchUserAllOrders = async (uId) => {
    if (!uId) return;
    try {
      const res = await gasGet(`?action=getUserAllOrdersMap&userId=${encodeURIComponent(uId)}&t=${Date.now()}`);
      const data = await res.json();
      if (data.success) {
        setUserOrdersMap(data.ordersMap || {});
      }
    } catch (err) {
      console.error("讀取個人訂單圖譜失敗", err);
    }
  };

  const loadBalanceHistory = async (year, month) => {
    if (authState !== AUTH_STATES.REGISTERED || !authUserId) return;

    const requestId = ++historyRequestRef.current;
    setHistoryLoading(true);
    setHistoryError('');
    setHistoryList([]);
    setHistorySummary({ openingBalance: 0, totalCredit: 0, totalDebit: 0, closingBalance: 0 });

    try {
      const accessToken = liff.getAccessToken();
      if (!accessToken) {
        setHistoryError('目前無法驗證身份，請重新登入後再試。');
        return;
      }
      const res = await gasPost({
          action: 'getBalanceHistoryByMonth',
          accessToken,
          year,
          month
      });
      const data = await res.json();
      if (requestId !== historyRequestRef.current) return;

      if (data.success) {
        setHistoryList(data.transactions || []);
        setHistorySummary({
          openingBalance: data.openingBalance || 0,
          totalCredit: data.totalCredit || 0,
          totalDebit: data.totalDebit || 0,
          closingBalance: data.closingBalance || 0
        });
      } else {
        setHistoryError('目前無法讀取此月份的交易明細，請稍後再試。');
      }
    } catch {
      if (requestId === historyRequestRef.current) {
        setHistoryError('目前無法讀取此月份的交易明細，請稍後再試。');
      }
    } finally {
      if (requestId === historyRequestRef.current) setHistoryLoading(false);
    }
  };

  const fetchBalanceHistory = () => {
    if (authState !== AUTH_STATES.REGISTERED || !authUserId) return;
    const currentMonth = getTaipeiYearMonth();
    setSelectedYear(currentMonth.year);
    setSelectedMonth(currentMonth.month);
    setShowHistoryModal(true);
    loadBalanceHistory(currentMonth.year, currentMonth.month);
  };

  const shiftHistoryMonth = (offset) => {
    if (historyLoading) return;
    const nextMonth = shiftYearMonth(selectedYear, selectedMonth, offset);
    setSelectedYear(nextMonth.year);
    setSelectedMonth(nextMonth.month);
    loadBalanceHistory(nextMonth.year, nextMonth.month);
  };

  const guardWrite = async (operation) => {
    if (!viewAsUser) return true;
    await showPopup({
      icon: 'info',
      title: '目前是檢視模式',
      text: `${operation}已停用，請先按「返回 Admin」再操作。`
    });
    return false;
  };

  const handleToggleLike = async (e, dateStr) => {
    e.stopPropagation(); // 防止觸發進入點餐頁面
    if (authState !== AUTH_STATES.REGISTERED || !authUserId) {
      await showPopup({ icon: 'warning', title: '需要已註冊 LINE 身份', text: authError || '請先完成 LINE 身份驗證' });
      return;
    }
    if (!(await guardWrite('愛心投票'))) return;

    // 樂觀更新前端 UI
    setCalendarEvents(prev => {
      const current = prev[dateStr] || { likeCount: 0, isUserLiked: false };
      const nextLiked = !current.isUserLiked;
      const nextCount = nextLiked ? current.likeCount + 1 : Math.max(0, current.likeCount - 1);
      return {
        ...prev,
        [dateStr]: {
          ...current,
          isUserLiked: nextLiked,
          likeCount: nextCount
        }
      };
    });

    try {
      const res = await gasPost({
          action: 'toggleLike',
          date: dateStr,
          accessToken: liff.getAccessToken(),
          userId: authUserId
      });
      const data = await res.json();
      if (data.success) {
        fetchCalendarEvents(); // 刷新同步後端開團狀態
      }
    } catch (err) {
      console.error("按讚失敗", err);
      fetchCalendarEvents(); // 失敗則還原
    }
  };

  const handleSelectDate = async (dateStr) => {
    if (authState !== AUTH_STATES.REGISTERED || !authUserId) {
      await showPopup({ icon: 'warning', title: '無法訂餐', text: authError || '目前無法驗證 LINE 身份' });
      return;
    }

    const event = calendarEvents[dateStr];

    if (adminManageMode && can('manageCalendar')) {
      setSelectedAdminDate(dateStr);
      setAdminVendorChoice(getConfiguredVendor(event));
      return;
    }

    if (!event || !event.vendor) {
      await showPopup({ icon: 'warning', title: '尚未開團', text: '若想吃蔡老師，可以點擊愛心投票開團。' });
      return;
    }

    setSelectedDate(dateStr);
    setLoading(true);
    setMessage('');
    setOrderNote('');
    setOrderItems({});
    setActiveOrderId('');
    setHasExistingOrder(false);

    try {
      const res = await gasGet(`?action=getOrderPageData&targetDate=${encodeURIComponent(dateStr)}&userId=${encodeURIComponent(authUserId)}&t=${Date.now()}`);
      const data = await res.json();
      if (data.success && data.myOrder && Array.isArray(data.myOrder.items)) {
        const orderMap = {};
        data.myOrder.items.forEach(item => {
          orderMap[item.item_id] = item.quantity;
        });

        setSetting(data.setting);
        setDeadline(data.deadline);
        setMenu(data.menu);
        setImageLoadErrors({});
        setOrderItems(orderMap);
        setActiveOrderId(data.myOrder.orderId || '');
        setHasExistingOrder(data.myOrder.items.length > 0);
        setOrderNote(data.myOrder.note || '');
        setViewMode('order');
      } else if (!data.success) {
        await showPopup({ icon: 'error', title: '讀取失敗', text: data.message || '讀取失敗' });
      } else {
        await showPopup({ icon: 'error', title: '讀取失敗', text: '無法取得既有訂單狀態，請稍後再試。' });
      }
    } catch (err) {
      await showPopup({ icon: 'error', title: '連線錯誤', text: '目前無法讀取訂餐資料，請稍後再試。' });
    } finally {
      setLoading(false);
    }
  };

  const saveAdminVendor = async (dateStr, vendor) => {
    if (!dateStr) return;
    if (!(await guardWrite('月曆設定'))) return;
    setLoading(true);
    try {
      const res = await gasPost({
          action: 'adminSetVendor',
          accessToken: liff.getAccessToken(),
          adminUserId: authUserId,
          dateStr,
          vendor
      });
      const data = await res.json();
      if (data.success) {
        await showPopup({ icon: 'success', title: '更新完成', text: '開團設定已更新！' });
        setSelectedAdminDate(null);
        fetchCalendarEvents();
      } else {
        await showPopup({ icon: 'error', title: '更新失敗', text: `更新失敗：${data.message}` });
      }
    } catch (err) {
      await showPopup({ icon: 'error', title: '連線失敗', text: '目前無法更新開團設定，請稍後再試。' });
    } finally {
      setLoading(false);
    }
  };

  const handleAdminSaveVendor = () => saveAdminVendor(selectedAdminDate, adminVendorChoice);

  const handleToggleAdminManage = () => {
    if (!can('manageCalendar') || viewAsUser) return;
    const nextMode = !adminManageMode;
    setAdminManageMode(nextMode);
    if (nextMode) {
      const today = formatDateInput(new Date());
      setSpecialAdminDate(today);
      setSpecialAdminVendorChoice(getConfiguredVendor(calendarEvents[today]));
    }
  };

  const handleSpecialAdminDateChange = (dateStr) => {
    setSpecialAdminDate(dateStr);
    const event = calendarEvents[dateStr];
    setSpecialAdminVendorChoice(event ? event.vendor || '' : '蔡老師');
  };

  const handleSpecialAdminSaveVendor = () => saveAdminVendor(specialAdminDate, specialAdminVendorChoice);

  const handleSubmit = async () => {
    if (loading || authState !== AUTH_STATES.REGISTERED || !authUserId) return;
    if (!(await guardWrite('訂單送出'))) return;
    if (isExpired) {
      await showPopup({ icon: 'warning', title: '已截止訂餐', text: '該日期已截止訂餐！' });
      return;
    }

    const items = Object.entries(orderItems)
      .map(([item_id, quantity]) => {
        const menuItem = menu.find(m => m.item_id === item_id);
        return {
          item_id,
          item_name: menuItem?.item_name || '',
          quantity,
          unit_price: menuItem?.price || 0
        };
      })
      .filter(i => i.quantity > 0);

    if (items.length === 0) {
      await showPopup({ icon: 'warning', title: '尚未選擇餐點', text: '請至少選擇一份便購' });
      return;
    }

    setLoading(true);
    try {
      const res = await gasPost({
          action: 'submitOrder',
          accessToken: liff.getAccessToken(),
          userId: authUserId,
          pickup_floor: floor,
          target_date: selectedDate,
          items,
          note: orderNote
      });
      const data = await res.json();
      if (data.success) {
        setMessage("✅ 訂單送出/扣款成功！");
        setHasExistingOrder(true);
        if (data.newBalance !== undefined) {
          setUserBalance(data.newBalance);
        }
        setActiveOrderId(data.orderId || '');
        fetchCalendarEvents();
        fetchUserAllOrders(authUserId);
      } else {
        setMessage("❌ " + data.message);
      }
    } catch (err) {
      setMessage("❌ 網路連線失敗");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelOrder = async () => {
    if (loading || authState !== AUTH_STATES.REGISTERED || !activeOrderId || !authUserId) return;
    if (!(await guardWrite('取消訂單'))) return;
    if (isExpired) {
      await showPopup({ icon: 'warning', title: '無法取消訂購', text: '已過截止時間，無法取消訂購！' });
      return;
    }
    const result = await showPopup({
      icon: 'question',
      title: '確認取消訂單？',
      text: `取消 ${selectedDate} 後將自動辦理退款。`,
      showCancelButton: true,
      confirmButtonText: '確定取消',
      cancelButtonText: '返回',
      cancelButtonColor: '#9CA3AF',
      reverseButtons: true
    });
    if (!result.isConfirmed) {
      return;
    }

    setLoading(true);
    try {
      const res = await gasPost({
          action: 'cancelOrder',
          accessToken: liff.getAccessToken(),
          userId: authUserId,
          orderId: activeOrderId,
          date: selectedDate
      });
      const data = await res.json();
      if (data.success) {
        setMessage("✅ 訂單已取消並完成退款");
        setOrderItems({});
        setActiveOrderId('');
        setHasExistingOrder(false);
        if (data.newBalance !== undefined && data.newBalance !== null) {
          setUserBalance(data.newBalance);
        }
        fetchCalendarEvents();
        fetchUserAllOrders(authUserId);
      } else {
        setMessage("❌ " + (data.message || "取消失敗"));
      }
    } catch (err) {
      setMessage("❌ 網路連線失敗");
    } finally {
      setLoading(false);
    }
  };

  const handleExitToCalendar = () => {
    setSelectedDate(null);
    setActiveOrderId('');
    setOrderItems({});
    setOrderNote('');
    setMessage('');
    setHasExistingOrder(false);
    setViewMode('calendar');
  };

  const handleAdminDateChange = (dateStr) => {
    if (!dateStr || authState !== AUTH_STATES.REGISTERED || !authUserId || !can('viewAdminOrderSummary')) return;
    setSelectedOrderDate(dateStr);
    loadAdminSummary(dateStr, authUserId, true);
  };

  const handleAdminSectionChange = (section) => {
    if (section === 'orders') {
      if (!can('viewAdminOrderSummary')) return;
      setAdminSection('orders');
      loadAdminSummary(selectedOrderDate, authUserId, true);
      return;
    }

    if (section === 'balances') {
      if (!can('viewMemberBalances')) return;
      setAdminSection('balances');
      setViewMode('admin');
      loadMemberBalances();
    }
  };

  const openAdminCalendar = () => {
    if (!can('manageCalendar') || viewAsUser) return;
    setAdminSection('calendar');
    setViewMode('calendar');
    setAdminManageMode(true);
    const today = formatDateInput(new Date());
    setSpecialAdminDate(today);
    setSpecialAdminVendorChoice(getConfiguredVendor(calendarEvents[today]));
  };

  const handleOpenViewAs = async () => {
    if (!canAuth('viewAsUser') || viewAsUser) return;
    setShowViewAsModal(true);
    await loadMemberBalances();
  };

  const handleSelectViewAs = (user) => {
    if (!user || !canAuth('viewAsUser')) return;
    setViewAsUser(user);
    setShowViewAsModal(false);
    setAdminManageMode(false);
    setSelectedAdminDate(null);
    setSelectedTopupUser(null);
    if (hasPermission(user.role, 'viewAdminOrderSummary')) {
      setAdminSection('orders');
      setViewMode('admin');
      loadAdminSummary(selectedOrderDate, authUserId, true);
    } else {
      setAdminSection('orders');
      setViewMode('calendar');
    }
  };

  const handleExitViewAs = () => {
    if (!viewAsUser) return;
    setViewAsUser(null);
    setShowViewAsModal(false);
    setSelectedTopupUser(null);
    setAdminManageMode(false);
    setSelectedAdminDate(null);
    setAdminSection('orders');
    if (hasPermission(authUser?.role, 'viewAdminOrderSummary')) {
      setViewMode('admin');
      loadAdminSummary(selectedOrderDate, authUserId, true);
    } else {
      setViewMode('calendar');
    }
  };

  const handleOpenTopupModal = (user) => {
    setSelectedTopupUser(user);
    setTopupAmount('');
    setTopupNote('現金收款');
  };

  const handleTopupSubmit = async () => {
    if (!selectedTopupUser || topupLoading || !can('topupMember')) return;
    if (!(await guardWrite('儲值'))) return;

    const amountText = String(topupAmount).trim();
    const amount = Number(amountText);
    if (!amountText || !Number.isFinite(amount) || amount <= 0) {
      await showPopup({ icon: 'warning', title: '金額不正確', text: '儲值金額必須大於 0。' });
      return;
    }

    setTopupLoading(true);
    try {
      const res = await gasPost({
          action: 'topUpBalance',
          accessToken: liff.getAccessToken(),
          adminUserId: authUserId,
          targetUserId: selectedTopupUser.userId,
          amount,
          note: topupNote.trim()
      });
      const data = await res.json();
      if (!data.success) {
        await showPopup({ icon: 'error', title: '儲值失敗', text: data.message || '儲值失敗' });
        return;
      }

      setMemberBalances(prev => prev.map(user => (
        user.userId === selectedTopupUser.userId
          ? { ...user, balance: data.newBalance }
          : user
      )));
    if (selectedTopupUser.userId === authUserId) {
        setUserBalance(data.newBalance);
        setAuthUser(prev => prev ? { ...prev, balance: data.newBalance } : prev);
      }
      setSelectedTopupUser(null);
      await showPopup({ icon: 'success', title: '儲值成功', text: `${selectedTopupUser.name} 的餘額已更新。` });
      setMemberBalancesLoaded(false);
      await loadMemberBalances(true);
    } catch (err) {
      await showPopup({ icon: 'error', title: '連線失敗', text: '目前無法完成儲值，請稍後再試。' });
    } finally {
      setTopupLoading(false);
    }
  };

  const getAggregatedOrders = () => {
    const aggregated = {};
    (adminSummary.todayOrders || []).forEach(o => {
      const key = `(${o.pickup_floor}) ${o.item_name}`;
      aggregated[key] = (aggregated[key] || 0) + o.quantity;
    });
    return aggregated;
  };

  const renderCalendarDays = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const firstWeekdayColumn = Math.min((firstDay + 6) % 7, 5); // 星期一為第 0 欄，週末落在首週末端
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const days = [];
    for (let i = 0; i < firstWeekdayColumn; i++) {
      days.push(<div key={`empty-${i}`} className="h-24 bg-gray-50/50 border border-gray-100 rounded-lg"></div>);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dayOfWeek = date.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;

      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const event = calendarEvents[dateStr];
      const eventExpired = Boolean(event?.isExpired || event?.expired);
      const isUserOrdered = Boolean(userOrdersMap[dateStr]);
      const hasVendor = Boolean(event?.vendor);

      let statusBg = "bg-white text-gray-400 border-gray-200";
      let statusBadge = null;

      if (hasVendor) {
        if (isUserOrdered) {
          if (eventExpired) {
            statusBg = "bg-slate-100 border-slate-300 text-slate-800 hover:bg-slate-200 cursor-pointer";
            statusBadge = <span className="text-[9px] bg-slate-500 text-white px-1 py-0.5 rounded font-medium">已訂/截止</span>;
          } else {
            statusBg = "bg-blue-50 border-blue-300 text-blue-900 hover:bg-blue-100 cursor-pointer shadow-sm";
            statusBadge = <span className="text-[9px] bg-blue-600 text-white px-1 py-0.5 rounded font-medium">已訂</span>;
          }
        } else {
          if (eventExpired) {
            statusBg = "bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100 cursor-pointer";
            statusBadge = <span className="text-[9px] bg-amber-200 text-amber-800 px-1 py-0.5 rounded">已截止</span>;
          } else {
            statusBg = "bg-emerald-50 border-emerald-300 text-emerald-900 hover:bg-emerald-100 cursor-pointer shadow-sm";
            statusBadge = <span className="text-[9px] bg-emerald-600 text-white px-1 py-0.5 rounded font-medium">預訂</span>;
          }
        }
      } else {
        // 未開團模式
        statusBg = "bg-gray-50/70 text-gray-400 border-dashed border-gray-200 hover:bg-gray-100 cursor-pointer";
      }

      // 1. 在 days.push 前，先根據當天的 dateStr 計算出農曆標籤
      const lunarLabel = getLunarLabel(dateStr);

      days.push(
        <div
          key={dateStr}
          onClick={() => handleSelectDate(dateStr)}
          className={`h-24 p-1.5 border rounded-xl flex flex-col justify-between transition-all relative ${statusBg}`}
        >
          <div className="flex justify-between items-start">
            <span className="font-bold text-sm leading-none">{day}</span>

            {/* 2. 改用計算出來的 lunarLabel，這樣每一天都能正確顯示初一/十五 */}
            {lunarLabel && (
              <span className="text-[9px] bg-rose-100 text-rose-700 font-bold px-1 rounded border border-rose-200">
                {lunarLabel === '初一' ? '初一' : lunarLabel === '十五' ? '十五' : lunarLabel}
              </span>
            )}
          </div>

          <div className="my-auto">
            {hasVendor ? (
              <div className="text-xs truncate font-bold text-gray-700">
                {event.vendor}
              </div>
            ) : (
              <div className="text-[10px] text-gray-400 font-normal">未開團</div>
            )}
          </div>

          <div className="flex justify-between items-end mt-1">
            {/* 愛心投票按鈕 */}
            <button
              onClick={(e) => handleToggleLike(e, dateStr)}
              disabled={isViewAsMode}
              className="flex items-center gap-0.5 text-xs focus:outline-none hover:scale-110 transition-transform disabled:cursor-not-allowed disabled:opacity-50"
              title="點愛心開蔡老師團"
            >
              <span>{event?.isUserLiked ? '❤️' : '🤍'}</span>
              <span className={`text-[10px] font-bold ${event?.likeCount > 0 ? 'text-rose-600' : 'text-gray-400'}`}>
                {event?.likeCount || 0}
              </span>
            </button>

            {statusBadge}
          </div>
        </div>
      );
    }
    return days;
  };

  const renderWeekendEvents = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const weekdayLabels = ['日', '一', '二', '三', '四', '五', '六'];

    return Object.entries(calendarEvents)
      .filter(([dateStr, event]) => {
        if (!event?.vendor) return false;
        const date = new Date(`${dateStr}T00:00:00`);
        const dayOfWeek = date.getDay();
        return !Number.isNaN(date.getTime())
          && date.getFullYear() === year
          && date.getMonth() === month
          && (dayOfWeek === 0 || dayOfWeek === 6);
      })
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .map(([dateStr, event]) => {
        const date = new Date(`${dateStr}T00:00:00`);
        const eventExpired = Boolean(event?.isExpired || event?.expired);

        return (
          <button
            key={dateStr}
            type="button"
            onClick={() => handleSelectDate(dateStr)}
            className="w-full text-left bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-xl p-3 transition-colors"
          >
            <div className="flex justify-between items-center gap-3">
              <span className="font-bold text-sm text-emerald-900">
                {date.getMonth() + 1}/{date.getDate()}（{weekdayLabels[date.getDay()]}）
              </span>
              <div className="flex items-center gap-2 text-xs">
                {event.likeCount > 0 && <span className="text-rose-600 font-bold">❤️ {event.likeCount}</span>}
                <span className={eventExpired ? 'bg-amber-100 text-amber-800 px-2 py-1 rounded-lg font-bold' : 'bg-emerald-600 text-white px-2 py-1 rounded-lg font-bold'}>
                  {eventExpired ? '已截止' : '預訂'}
                </span>
              </div>
            </div>
            <div className="text-xs text-gray-700 font-bold mt-1">{event.vendor}</div>
          </button>
        );
      });
  };

  const totalCount = Object.values(orderItems).reduce((a, b) => a + b, 0);
  const totalPrice = Object.entries(orderItems).reduce((sum, [id, qty]) => {
    const item = menu.find(m => m.item_id === id);
    return sum + (item ? item.price * qty : 0);
  }, 0);

  const groupedMenu = useMemo(() => {
    const groups = new Map();

    menu.forEach(item => {
      const { baseName, variant } = parseMenuItemName(item.item_name);
      const groupKey = baseName || item.item_name;
      const group = groups.get(groupKey) || {
        baseName: groupKey,
        baseImageUrl: '',
        variantImageUrl: '',
        items: []
      };

      group.items.push({ ...item, displayVariant: variant });
      if (!variant && item.image_url) {
        group.baseImageUrl = item.image_url;
      } else if (variant && item.image_url && !group.variantImageUrl) {
        group.variantImageUrl = item.image_url;
      }
      groups.set(groupKey, group);
    });

    return Array.from(groups.values()).map(group => ({
      ...group,
      imageUrl: group.baseImageUrl || group.variantImageUrl
    }));
  }, [menu]);

  // 修復版：精確比對 Intl 回傳的農曆日期
  const getLunarLabel = (dateStr) => {
    if (!dateStr) return '';
    try {
      const [year, month, day] = dateStr.split('-').map(Number);
      const date = new Date(year, month - 1, day);

      // 取得農曆日期的格式化字串
      const formatter = new Intl.DateTimeFormat('zh-TW-u-ca-chinese', {
        day: 'numeric'
      });
      const lunarText = formatter.format(date); // 可能會是 "1", "1日", "初一", "15", "15日", "十五" 等

      // 使用正規表示式或包含比對
      if (lunarText.includes('初一') || lunarText === '1' || lunarText === '1日') {
        return '初一';
      }
      if (lunarText.includes('十五') || lunarText === '15' || lunarText === '15日') {
        return '十五';
      }
      return '';
    } catch (e) {
      return '';
    }
  };

  const aggregatedOrders = getAggregatedOrders();
  const isRegistered = authState === AUTH_STATES.REGISTERED;
  const isUnregistered = authState === AUTH_STATES.UNREGISTERED;
  const authUserId = authUser?.userId || lineUserId;
  const authRole = authUser?.role || 'User';
  const effectiveUser = viewAsUser || authUser;
  const effectiveRole = effectiveUser?.role || 'User';
  const isViewAsMode = Boolean(viewAsUser);
  const can = (permission) => isRegistered && hasPermission(effectiveRole, permission);
  const canAuth = (permission) => isRegistered && hasPermission(authRole, permission);
  const authStateLabel = {
    [AUTH_STATES.AUTH_LOADING]: '身份驗證中',
    [AUTH_STATES.AUTH_REQUIRED]: '請登入 LINE',
    [AUTH_STATES.AUTH_FAILED]: '身份驗證失敗',
    [AUTH_STATES.UNREGISTERED]: '尚未註冊',
    [AUTH_STATES.REGISTERED]: '身份已驗證'
  }[authState];
  const displayName = effectiveUser?.name || name || registrationDisplayName || authStateLabel;
  const displayFloor = effectiveUser?.defaultFloor || effectiveUser?.floor || defaultFloor;
  const displayBalance = effectiveUser?.balance ?? userBalance;
  const weekendEvents = renderWeekendEvents();

  return (
    <div className="min-h-screen bg-[#F7F5F0] text-gray-800 pb-24">
      <header className="bg-[#2C4A3E] text-white p-4 shadow-md">
        <div className="max-w-xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold">蔬食便當預訂系統</h1>
            <div className="mt-1 text-xs text-emerald-100 flex flex-wrap items-center gap-1.5">
              <span>👤 {displayName}</span>
              {effectiveUser && isRegistered && <span className="bg-emerald-800/80 px-1.5 py-0.5 rounded">{effectiveRole}</span>}
              {displayFloor && <span className="text-emerald-200">預設領取：{displayFloor}</span>}
            </div>
            {isRegistered && !isViewAsMode && can('viewOwnBalance') && (
              <button
                onClick={fetchBalanceHistory}
                className="text-xs text-emerald-200 hover:underline flex items-center gap-1 mt-0.5 focus:outline-none"
              >
                儲值餘額：
                <span className={`font-bold px-1.5 py-0.5 rounded text-xs ${displayBalance < 0 ? 'bg-red-900/80 text-red-200' : 'bg-emerald-900/80 text-yellow-300'}`}>
                  {formatBalanceAmount(displayBalance)}
                </span>
              </button>
            )}
            <ViewAsBanner
              viewAsUser={isViewAsMode ? viewAsUser : null}
              displayBalance={displayBalance}
              onExit={handleExitViewAs}
            />
          </div>
          <div className="flex gap-2">
            {isRegistered && canAuth('viewAsUser') && !isViewAsMode && (
              <button
                type="button"
                onClick={handleOpenViewAs}
                className="bg-emerald-800 hover:bg-emerald-700 text-emerald-100 text-xs px-2.5 py-1.5 rounded-lg transition shadow-sm font-bold"
              >
                👁 檢視身分
              </button>
            )}
            {isRegistered && can('viewAdminOrderSummary') && (
              <button
                type="button"
                onClick={() => handleAdminSectionChange('orders')}
                className={`text-xs px-2.5 py-1.5 rounded-lg transition shadow-sm font-bold ${viewMode === 'admin' && adminSection === 'orders' ? 'bg-amber-600 text-white' : 'bg-emerald-800 text-emerald-100'}`}
              >
                📋 訂單管理
              </button>
            )}
            {isRegistered && can('viewMemberBalances') && (
              <button
                type="button"
                onClick={() => handleAdminSectionChange('balances')}
                className={`text-xs px-2.5 py-1.5 rounded-lg transition shadow-sm font-bold ${viewMode === 'admin' && adminSection === 'balances' ? 'bg-amber-600 text-white' : 'bg-emerald-800 text-emerald-100'}`}
              >
                💰 餘額管理
              </button>
            )}
            {isRegistered && can('manageCalendar') && viewMode === 'calendar' && (
              <button
                type="button"
                onClick={adminManageMode ? handleToggleAdminManage : openAdminCalendar}
                disabled={isViewAsMode}
                className={`text-xs px-2.5 py-1.5 rounded-lg transition shadow-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${adminManageMode ? 'bg-rose-600 text-white' : 'bg-emerald-800 text-emerald-100'}`}
              >
                {adminManageMode ? '🔒 離開管理' : '📅 月曆管理'}
              </button>
            )}
            {isRegistered && viewMode !== 'calendar' && (
              <button
                onClick={handleExitToCalendar}
                className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs px-3 py-1.5 rounded-lg transition"
              >
                📅 月曆
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto p-4">
        {authState === AUTH_STATES.AUTH_REQUIRED && !loading && (
          <div className="mb-4 text-center bg-white rounded-3xl p-6 shadow-sm border border-emerald-900/10 space-y-4">
            <div className="text-4xl">🔐</div>
            <h2 className="text-xl font-bold text-[#2C4A3E]">需要登入 LINE</h2>
            <p className="text-sm text-gray-500">請完成 LINE 登入後再使用便當預訂功能。</p>
            <button
              type="button"
              onClick={initLiffAndFetchData}
              className="w-full rounded-2xl bg-[#2C4A3E] py-3.5 text-sm font-bold text-white shadow-md transition hover:bg-emerald-800"
            >
              登入 LINE
            </button>
          </div>
        )}

        {authState === AUTH_STATES.AUTH_FAILED && !loading && (
          <div className="mb-4 text-center text-sm font-bold p-3 rounded-xl bg-amber-50 text-amber-800 border border-amber-200">
            <div className="mb-2">身份驗證失敗</div>
            <div className="font-normal">{authError || `${authStage}: 無法取得有效 LINE 身份`}</div>
            <button
              type="button"
              onClick={initLiffAndFetchData}
              className="mt-3 rounded-xl bg-[#2C4A3E] px-4 py-2 text-white"
            >
              重新驗證
            </button>
          </div>
        )}

        {(authState === AUTH_STATES.AUTH_LOADING || (isRegistered && loading)) && (
          <div className="text-center py-8 text-emerald-800 font-medium animate-pulse">
            資料處理中...
          </div>
        )}

        {isUnregistered && !loading && (
          <div className="bg-white rounded-3xl p-6 shadow-sm border border-emerald-900/10 space-y-6">
            <div className="text-center space-y-2">
              <div className="text-4xl">🍱</div>
              <h2 className="text-2xl font-bold text-[#2C4A3E]">歡迎加入便當預訂</h2>
              <p className="text-sm text-gray-500">完成設定後即可開始使用</p>
            </div>

            <div className="space-y-2 text-sm">
              <div className="text-gray-500">姓名</div>
              <div className="rounded-2xl bg-gray-50 border border-gray-100 px-4 py-3 font-bold text-gray-800">
                {registrationDisplayName}
              </div>
            </div>

            <div className="space-y-3 text-sm">
              <div className="text-gray-500">預設領取樓層：</div>
              <div className="grid grid-cols-2 gap-3">
                {['1樓', '9樓'].map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setRegistrationFloor(option)}
                    aria-pressed={registrationFloor === option}
                    className={`rounded-2xl border py-3 font-bold transition ${registrationFloor === option
                      ? 'border-[#2C4A3E] bg-[#2C4A3E] text-white shadow-sm'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-emerald-600'
                      }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={handleRegister}
              disabled={registrationLoading}
              className="w-full rounded-2xl bg-[#2C4A3E] py-3.5 text-sm font-bold text-white shadow-md transition hover:bg-emerald-800 disabled:bg-gray-300"
            >
              {registrationLoading ? '註冊中...' : '開始使用'}
            </button>
          </div>
        )}

        {isRegistered && viewMode === 'calendar' && !loading && (
          <CalendarManagement
            currentMonth={currentMonth}
            onPreviousMonth={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
            onNextMonth={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
            adminManageMode={adminManageMode}
            specialAdminDate={specialAdminDate}
            onSpecialAdminDateChange={handleSpecialAdminDateChange}
            specialAdminVendorChoice={specialAdminVendorChoice}
            onVendorChange={setSpecialAdminVendorChoice}
            onSaveVendor={handleSpecialAdminSaveVendor}
            loading={loading}
            renderCalendarDays={renderCalendarDays}
            weekendEvents={weekendEvents}
          />
        )}

        {isRegistered && viewMode === 'order' && !loading && (
          <OrderPage
            selectedDate={selectedDate}
            setting={setting}
            isExpired={isExpired}
            isViewAsMode={isViewAsMode}
            floor={floor}
            onFloorChange={setFloor}
            orderNote={orderNote}
            onOrderNoteChange={setOrderNote}
            groupedMenu={groupedMenu}
            imageLoadErrors={imageLoadErrors}
            onImageError={(groupName) => setImageLoadErrors(prev => ({ ...prev, [groupName]: true }))}
            orderItems={orderItems}
            onDecreaseItem={(itemId, qty) => setOrderItems(prev => ({ ...prev, [itemId]: Math.max(0, qty - 1) }))}
            onIncreaseItem={(itemId, qty) => setOrderItems(prev => ({ ...prev, [itemId]: qty + 1 }))}
            message={message}
          />
        )}

        {isRegistered && viewMode === 'admin' && !loading && (
          <div className="space-y-4">
            {adminSection === 'orders' && (
              <AdminOrderSummary
                selectedOrderDate={selectedOrderDate}
                onDateChange={handleAdminDateChange}
                adminSummary={adminSummary}
                adminSummaryLoading={adminSummaryLoading}
                adminSummaryError={adminSummaryError}
                aggregatedOrders={aggregatedOrders}
              />
            )}

            {adminSection === 'balances' && can('viewMemberBalances') && (
              <MemberBalanceManagement
                memberBalances={memberBalances}
                memberBalancesLoading={memberBalancesLoading}
                memberBalancesError={memberBalancesError}
                canTopup={can('topupMember')}
                isViewAsMode={isViewAsMode}
                onOpenTopupModal={handleOpenTopupModal}
              />
            )}
          </div>
        )}

      </main>

      {/* 底部導覽/操作列 */}
      {isRegistered && viewMode === 'order' && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4 shadow-lg z-40">
          <div className="max-w-xl mx-auto flex justify-between items-center">
            <div>
              <div className="text-xs text-gray-500">
                已選 <span className="font-bold bg-gray-100 px-1.5 py-0.5 rounded text-gray-800 border">{totalCount}</span> 份便購
              </div>
              <div className="text-xl font-bold text-[#2C4A3E]">${totalPrice}</div>
            </div>
            {!isExpired ? (
              <div className="flex gap-2">
                {hasExistingOrder && (
                  <button
                    onClick={handleCancelOrder}
                    disabled={loading || !activeOrderId || isViewAsMode}
                    className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl disabled:bg-gray-300 transition active:scale-95 shadow-sm"
                  >
                    取消訂餐
                  </button>
                )}
                <button
                  onClick={handleSubmit}
                  disabled={loading || totalCount === 0 || isViewAsMode}
                  className="bg-[#2C4A3E] text-white text-xs font-bold px-5 py-2.5 rounded-xl hover:bg-emerald-800 disabled:bg-gray-300 transition active:scale-95 shadow-sm"
                >
                  確認扣款送出
                </button>
              </div>
            ) : (
              <button
                onClick={handleExitToCalendar}
                className="bg-gray-600 hover:bg-gray-700 text-white font-bold px-8 py-2.5 rounded-xl transition active:scale-95 shadow-sm"
              >
                離開
              </button>
            )}
          </div>
        </div>
      )}

      {/* 餘額歷史異動 Modal 彈窗 */}
      {showHistoryModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-opacity">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl transform transition-all max-h-[85vh] flex flex-col border border-emerald-100">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <h3 className="font-bold text-base text-[#2C4A3E] flex items-center gap-2">
                <span className="text-xl">💳</span> 個人儲值/交易明細
              </h3>
              <button
                onClick={() => setShowHistoryModal(false)}
                className="text-gray-400 hover:text-rose-500 text-lg font-bold bg-gray-50 hover:bg-rose-50 rounded-full w-8 h-8 flex items-center justify-center transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-2xl bg-emerald-50 px-2 py-2">
              <button
                type="button"
                aria-label="上一個月"
                onClick={() => shiftHistoryMonth(-1)}
                disabled={historyLoading}
                className="min-w-10 min-h-10 rounded-xl bg-white text-[#2C4A3E] font-bold shadow-sm disabled:text-gray-300"
              >
                ◀
              </button>
              <span className="text-sm font-bold text-[#2C4A3E]" aria-live="polite">
                {selectedYear} 年 {selectedMonth} 月
              </span>
              <button
                type="button"
                aria-label="下一個月"
                onClick={() => shiftHistoryMonth(1)}
                disabled={historyLoading}
                className="min-w-10 min-h-10 rounded-xl bg-white text-[#2C4A3E] font-bold shadow-sm disabled:text-gray-300"
              >
                ▶
              </button>
            </div>

            {!historyLoading && !historyError && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-2.5">
                  <div className="text-gray-500">月初餘額</div>
                  <div className="font-bold text-gray-800 mt-1">{formatBalanceAmount(historySummary.openingBalance)}</div>
                </div>
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-2.5">
                  <div className="text-gray-500">月底餘額</div>
                  <div className="font-bold text-gray-800 mt-1">{formatBalanceAmount(historySummary.closingBalance)}</div>
                </div>
                <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-2.5">
                  <div className="text-emerald-700">本月增加</div>
                  <div className="font-bold text-emerald-800 mt-1">+${historySummary.totalCredit}</div>
                </div>
                <div className="rounded-xl bg-rose-50 border border-rose-100 p-2.5">
                  <div className="text-rose-700">本月扣除</div>
                  <div className="font-bold text-rose-800 mt-1">-${historySummary.totalDebit}</div>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
              {historyLoading ? (
                <p className="text-center text-xs text-gray-400 py-6 animate-pulse">載入明細中...</p>
              ) : historyError ? (
                <p className="text-center text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-xl p-4">{historyError}</p>
              ) : historyList.length === 0 ? (
                <p className="text-center text-xs text-gray-400 py-6">此月份沒有交易紀錄</p>
              ) : (
                historyList.map((item, idx) => (
                  <div key={idx} className="bg-gray-50/80 p-3.5 rounded-2xl flex justify-between items-center text-xs border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                    <div>
                      <div className="font-bold text-gray-700 text-sm mb-1">{item.description || item.note || item.type || '交易異動'}</div>
                      <div className="text-[10px] text-gray-400">{item.occurredAt || item.timestamp}</div>
                    </div>
                    <div className="text-right">
                      <div className={`font-bold text-xs px-2 py-1 rounded-lg inline-block ${(item.amount ?? item.changeAmount) >= 0 ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-rose-100 text-rose-600 border border-rose-200'}`}>
                        {formatSignedAmount(item.amount ?? item.changeAmount)}
                      </div>
                      <div className="text-[10px] text-gray-500 mt-1.5 font-medium">結餘: {formatBalanceAmount(item.balanceAfter ?? item.balance)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <button
              onClick={() => setShowHistoryModal(false)}
              className="w-full bg-[#2C4A3E] text-white py-3 rounded-2xl text-sm font-bold hover:bg-emerald-800 transition shadow-md active:scale-95"
            >
              關閉
            </button>
          </div>
        </div>
      )}

      {showViewAsModal && canAuth('viewAsUser') && !isViewAsMode && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-opacity">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl border border-emerald-100">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <div>
                <h3 className="font-bold text-base text-[#2C4A3E]">👁 以其他身分檢視</h3>
                <p className="text-xs text-gray-500 mt-1">只預覽 UI，選取後不會代替對方執行操作。</p>
              </div>
              <button
                type="button"
                onClick={() => setShowViewAsModal(false)}
                className="text-gray-400 hover:text-rose-500 text-lg font-bold bg-gray-50 hover:bg-rose-50 rounded-full w-8 h-8 flex items-center justify-center transition-colors"
              >
                ✕
              </button>
            </div>

            {memberBalancesLoading ? (
              <p className="text-center text-sm text-emerald-800 animate-pulse py-6">讀取成員列表中...</p>
            ) : memberBalancesError ? (
              <div className="text-center text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-xl p-4">
                {memberBalancesError}
              </div>
            ) : memberBalances.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-6">目前沒有可檢視的成員資料</p>
            ) : (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                {memberBalances.map((user, idx) => (
                  <button
                    type="button"
                    key={user.userId || `view-as-${idx}`}
                    onClick={() => handleSelectViewAs(user)}
                    className="w-full text-left rounded-2xl border border-gray-100 bg-gray-50 hover:bg-emerald-50 hover:border-emerald-200 p-3 transition-colors"
                  >
                    <span className="font-bold text-gray-800">{user.name}</span>
                    <span className="ml-2 text-xs text-gray-500">{user.floor}</span>
                    <span className="ml-2 text-xs font-bold text-emerald-800">{user.role}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {selectedTopupUser && can('topupMember') && !isViewAsMode && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-opacity">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-5 shadow-2xl transform transition-all border border-emerald-100">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <h3 className="font-bold text-base text-[#2C4A3E] flex items-center gap-2">
                <span className="text-xl">💰</span> 儲值：{selectedTopupUser.name}
              </h3>
              <button
                type="button"
                onClick={() => setSelectedTopupUser(null)}
                disabled={topupLoading}
                className="text-gray-400 hover:text-rose-500 text-lg font-bold bg-gray-50 hover:bg-rose-50 rounded-full w-8 h-8 flex items-center justify-center transition-colors disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="bg-emerald-50 rounded-2xl p-3 text-emerald-900">
                目前餘額：<span className="font-bold">{formatBalanceAmount(selectedTopupUser.balance)}</span>
              </div>
              <div>
                <label className="block text-gray-600 font-bold mb-2 text-sm" htmlFor="topup-amount">儲值金額</label>
                <input
                  id="topup-amount"
                  type="number"
                  min="0.01"
                  step="any"
                  inputMode="decimal"
                  value={topupAmount}
                  onChange={(e) => setTopupAmount(e.target.value)}
                  disabled={topupLoading}
                  className="w-full border border-gray-200 rounded-2xl p-3.5 bg-gray-50 text-sm focus:outline-emerald-600 focus:bg-white transition-colors shadow-sm disabled:bg-gray-100"
                />
              </div>
              <div>
                <label className="block text-gray-600 font-bold mb-2 text-sm" htmlFor="topup-note">備註</label>
                <input
                  id="topup-note"
                  type="text"
                  value={topupNote}
                  onChange={(e) => setTopupNote(e.target.value)}
                  disabled={topupLoading}
                  className="w-full border border-gray-200 rounded-2xl p-3.5 bg-gray-50 text-sm focus:outline-emerald-600 focus:bg-white transition-colors shadow-sm disabled:bg-gray-100"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSelectedTopupUser(null)}
                disabled={topupLoading}
                className="w-1/2 bg-gray-100 text-gray-600 py-3 rounded-2xl text-sm font-bold hover:bg-gray-200 transition active:scale-95 shadow-sm disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleTopupSubmit}
                disabled={topupLoading}
                className="w-1/2 bg-[#2C4A3E] text-white py-3 rounded-2xl text-sm font-bold hover:bg-emerald-800 disabled:bg-gray-300 transition active:scale-95 shadow-md"
              >
                {topupLoading ? '處理中...' : '確認儲值'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin 手動修改開團彈窗 Modal */}
      {selectedAdminDate && can('manageCalendar') && !isViewAsMode && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-opacity">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-5 shadow-2xl transform transition-all border border-emerald-100">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <h3 className="font-bold text-base text-[#2C4A3E] flex items-center gap-2">
                <span className="text-xl">🛠️</span> 開團管理：{selectedAdminDate}
              </h3>
              <button
                onClick={() => setSelectedAdminDate(null)}
                className="text-gray-400 hover:text-rose-500 text-lg font-bold bg-gray-50 hover:bg-rose-50 rounded-full w-8 h-8 flex items-center justify-center transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-gray-600 font-bold mb-2 text-sm">選擇店家</label>
                <select
                  value={adminVendorChoice}
                  onChange={(e) => setAdminVendorChoice(e.target.value)}
                  className="w-full border border-gray-200 rounded-2xl p-3.5 bg-gray-50 text-sm focus:outline-emerald-600 focus:bg-white transition-colors shadow-sm"
                >
                  <option value="蔡老師">蔡老師</option>
                  <option value="禾拾">禾拾</option>
                  <option value="合十">合十</option>
                  <option value="">不開團</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setSelectedAdminDate(null)}
                className="w-1/2 bg-gray-100 text-gray-600 py-3 rounded-2xl text-sm font-bold hover:bg-gray-200 transition active:scale-95 shadow-sm"
              >
                取消
              </button>
              <button
                onClick={handleAdminSaveVendor}
                className="w-1/2 bg-[#2C4A3E] text-white py-3 rounded-2xl text-sm font-bold hover:bg-emerald-800 transition active:scale-95 shadow-md"
              >
                儲存更新
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
