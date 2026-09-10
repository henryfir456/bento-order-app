import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';
import { formatDateInput, getTaipeiYearMonth, getWeekdayLeadingBlankCount, shiftYearMonth } from './dateUtils';
import { apiClient, guestSessionStore } from './api/apiClient';
import { getApiErrorPresentation } from './api/apiErrors';
import {
  clearClientRequestKey,
  createClientRequestKey,
  getStableClientRequestKey
} from './api/clientRequestKeys';
import { normalizeWorkerLikeResponse, restoreCalendarEvent } from './api/likeState';
import { authClient } from './auth/liffClient';
import { hasPermission } from './auth/permissions';
import { AUTH_BOOT_STAGES } from './auth/bootFlow';
import { createBootId, createBootTimingLogger, getPerformanceNow } from './observability/bootTiming';
import { APP_VERSION, UI_CHANGELOG } from './data/changelog';
import ChangelogModal from './components/ChangelogModal';
import EmployeeGuestLogin from './components/EmployeeGuestLogin';
import PickupFloorModal from './components/PickupFloorModal';
import ViewAsBanner from './components/ViewAsBanner';
import DevAuthBadge from './components/DevAuthBadge';
import AnnouncementBar from './components/AnnouncementBar';
import AnnouncementModal from './components/AnnouncementModal';
import CalendarManagement from './features/calendar/CalendarManagement';
import OrderPage from './features/orders/OrderPage';
import ImagePreviewModal from './features/orders/ImagePreviewModal';
import OrderConfirmationModal from './features/orders/OrderConfirmationModal';
import {
  buildExistingOrderSubmission,
  buildOrderSubmission
} from './features/orders/orderSubmission';
import AdminOrderSummary from './features/admin/AdminOrderSummary';
import AnnouncementManagement from './features/admin/AnnouncementManagement';
import MemberBalanceManagement from './features/balances/MemberBalanceManagement';
import { formatSignedAmount, formatBalanceAmount } from './features/balances/formatters';

// 自動根據目前環境讀取對應的變數
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

const logPerformanceTiming = (label, startTime) => {
  if (!import.meta.env.DEV) return;
  const elapsedMs = getPerformanceNow() - startTime;
  console.info(`[PERF] ${label}_MS=${elapsedMs.toFixed(1)}`);
};

const normalizeDeferredLikes = (rawLikes) => {
  if (!rawLikes || typeof rawLikes !== 'object' || Array.isArray(rawLikes)) return null;

  return Object.entries(rawLikes).reduce((result, [dateStr, state]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return result;

    const likeCount = Number(state?.likeCount);
    if (!Number.isFinite(likeCount) || likeCount < 0 || typeof state?.isUserLiked !== 'boolean') {
      return result;
    }

    result[dateStr] = {
      likeCount: Math.floor(likeCount),
      isUserLiked: state.isUserLiked,
      calendarEvent: state.calendarEvent && typeof state.calendarEvent === 'object'
        ? {
          order_date: String(state.calendarEvent.order_date || '').trim(),
          vendor: String(state.calendarEvent.vendor || ''),
          mode: String(state.calendarEvent.mode || ''),
          deadline: String(state.calendarEvent.deadline || ''),
          isExpired: Boolean(state.calendarEvent.isExpired),
          lunarLabel: state.calendarEvent.lunarLabel == null
            ? null
            : String(state.calendarEvent.lunarLabel)
        }
        : null
    };
    return result;
  }, {});
};

const normalizeDeferredAnnouncements = (rawAnnouncements) => {
  if (!Array.isArray(rawAnnouncements)) return null;

  return rawAnnouncements.reduce((result, announcement) => {
    const id = String(announcement?.id || '').trim();
    const title = String(announcement?.title || '').trim();
    const content = String(announcement?.content || '');
    const startDate = String(announcement?.start_date || '').trim();
    const endDate = String(announcement?.end_date || '').trim();

    if (!id || !title || !content.trim()) return result;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return result;
    }

    result.push({
      id,
      title,
      content,
      start_date: startDate,
      end_date: endDate
    });
    return result;
  }, []);
};

const mergeDeferredLikes = (events, likes) => Object.entries(likes).reduce((result, [dateStr, likeState]) => {
  const { calendarEvent, ...likeStateWithoutEvent } = likeState;
  if (!result[dateStr] && calendarEvent?.order_date === dateStr && calendarEvent.mode) {
    result[dateStr] = { ...calendarEvent, ...likeStateWithoutEvent };
  } else if (result[dateStr]) {
    result[dateStr] = { ...result[dateStr], ...likeStateWithoutEvent };
  }
  return result;
}, { ...events });

const fetchDeferredBootstrapData = async (accessToken, bootId) => {
  try {
    if (!accessToken) {
      return { success: false, code: 'DEFERRED_UI_TOKEN_MISSING' };
    }

    const res = await apiClient.getDeferredBootstrap({ bootId });
    if (!res.ok) {
      return { success: false, code: 'DEFERRED_UI_HTTP_ERROR' };
    }
    return await res.json();
  } catch {
    return { success: false, code: 'DEFERRED_UI_REQUEST_FAILED' };
  }
};

const fetchBootstrapData = async (accessToken, bootId) => {
  try {
    if (!accessToken) {
      return { success: false, message: 'LIFF accessToken 不存在' };
    }

    const res = await apiClient.getBootstrap({ bootId });
    if (!res.ok) {
      return { success: false, message: `backend HTTP ${res.status}` };
    }
    return await res.json();
  } catch (err) {
    const safeMessage = redactAuthSecrets(err instanceof Error ? err.message : err);
    logAuthDiagnostic(`BOOTSTRAP_REQUEST_SUCCESS=false error=${safeMessage}`);
    return { success: false, message: safeMessage, code: err?.code || null };
  }
};

const showPopup = (options) => Swal.fire({
  confirmButtonText: '確定',
  confirmButtonColor: '#2C4A3E',
  customClass: {
    popup: 'rounded-3xl',
    confirmButton: 'rounded-xl'
  },
  ...options
});

const showToast = (options) => Swal.fire({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 1800,
  timerProgressBar: true,
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

const normalizeWorkerOrderMenu = (items) => (Array.isArray(items) ? items : []).map(item => ({
  ...item,
  item_id: item.menu_item_id || item.item_id
}));

export default function App() {
  const [viewMode, setViewMode] = useState('calendar');
  const [calendarEvents, setCalendarEvents] = useState({});
  const [userOrdersMap, setUserOrdersMap] = useState({});
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const [lineUserId, setLineUserId] = useState('');
  const [authMode, setAuthMode] = useState(null);
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
  const [employeeGuestId, setEmployeeGuestId] = useState('');
  const [employeeGuestLoading, setEmployeeGuestLoading] = useState(false);
  const [employeeGuestError, setEmployeeGuestError] = useState('');
  const [lineBindLoading, setLineBindLoading] = useState(false);
  const authInitInFlightRef = useRef(false);
  const authBootPromiseRef = useRef(null);
  const authBootCompletedRef = useRef(false);
  const employeeGuestRequestRef = useRef(false);
  const bootRenderPendingRef = useRef(null);
  const deferredUiGenerationRef = useRef(0);
  const deferredUiBootRef = useRef('');

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
  const [activeOrderSnapshot, setActiveOrderSnapshot] = useState(null);
  const [hasExistingOrder, setHasExistingOrder] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [showOrderConfirmation, setShowOrderConfirmation] = useState(false);
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const orderSubmitRequestRef = useRef(null);
  const orderCancelRequestRef = useRef(null);
  const orderMutationInFlightRef = useRef(false);

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
  const [adminAnnouncements, setAdminAnnouncements] = useState([]);
  const [adminAnnouncementsLoading, setAdminAnnouncementsLoading] = useState(false);
  const [adminAnnouncementsError, setAdminAnnouncementsError] = useState('');
  const [adminAnnouncementsLoaded, setAdminAnnouncementsLoaded] = useState(false);
  const adminAnnouncementsRequestRef = useRef(0);
  const [memberBalances, setMemberBalances] = useState([]);
  const [memberBalancesLoading, setMemberBalancesLoading] = useState(false);
  const [memberBalancesError, setMemberBalancesError] = useState('');
  const [memberBalancesLoaded, setMemberBalancesLoaded] = useState(false);
  const memberBalancesRequestRef = useRef(0);
  const [showViewAsModal, setShowViewAsModal] = useState(false);
  const [showFloorModal, setShowFloorModal] = useState(false);
  const [floorDraft, setFloorDraft] = useState('');
  const [floorLoading, setFloorLoading] = useState(false);
  const [floorError, setFloorError] = useState('');
  const [showChangelogModal, setShowChangelogModal] = useState(false);
  const [announcements, setAnnouncements] = useState([]);
  const [likesLoaded, setLikesLoaded] = useState(false);
  const [likeMutationInFlight, setLikeMutationInFlight] = useState(false);
  const likeMutationInFlightRef = useRef(false);
  const [announcementsLoaded, setAnnouncementsLoaded] = useState(false);
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);

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
  const [topupIdempotencyKey, setTopupIdempotencyKey] = useState('');

  // Admin 管理月曆彈窗狀態
  const [adminManageMode, setAdminManageMode] = useState(false);
  const [selectedAdminDate, setSelectedAdminDate] = useState(null);
  const [adminVendorChoice, setAdminVendorChoice] = useState('蔡老師');
  const [specialAdminDate, setSpecialAdminDate] = useState(formatDateInput(new Date()));
  const [specialAdminVendorChoice, setSpecialAdminVendorChoice] = useState('蔡老師');

  const isExpired = Boolean(deadline?.isExpired || deadline?.expired);

  const readCurrentCredential = useCallback(() => {
    if (apiClient.transport === 'worker' && authMode === 'employee_guest') {
      return guestSessionStore.getGuestSession()?.token || '';
    }
    return authClient.getAccessToken();
  }, [authMode]);

  const clearIdentityData = () => {
    adminSummaryRequestRef.current += 1;
    adminAnnouncementsRequestRef.current += 1;
    historyRequestRef.current += 1;
    memberBalancesRequestRef.current += 1;
    deferredUiGenerationRef.current += 1;
    deferredUiBootRef.current = '';
    setLineUserId('');
    setAuthMode(null);
    setAuthUser(null);
    setViewAsUser(null);
    setUserBalance(0);
    setDefaultFloor('');
    setRegistrationDisplayName('');
    setEmployeeGuestError('');
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
    setActiveOrderSnapshot(null);
    setHasExistingOrder(false);
    setMessage('');
    setShowOrderConfirmation(false);
    setShowCancelConfirmation(false);
    setCancelError('');
    clearClientRequestKey(orderSubmitRequestRef);
    clearClientRequestKey(orderCancelRequestRef);
    orderMutationInFlightRef.current = false;
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
    setAdminAnnouncements([]);
    setAdminAnnouncementsLoading(false);
    setAdminAnnouncementsError('');
    setAdminAnnouncementsLoaded(false);
    setMemberBalances([]);
    setMemberBalancesLoading(false);
    setMemberBalancesError('');
    setMemberBalancesLoaded(false);
    setShowViewAsModal(false);
    setShowFloorModal(false);
    setFloorDraft('');
    setFloorError('');
    setShowChangelogModal(false);
    setAnnouncements([]);
    setLikesLoaded(false);
    setAnnouncementsLoaded(false);
    setShowAnnouncementModal(false);
    setImagePreview(null);
    setAdminManageMode(false);
    setSelectedAdminDate(null);
    setSelectedTopupUser(null);
    likeMutationInFlightRef.current = false;
    setLikeMutationInFlight(false);
    setTopupIdempotencyKey('');
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

  const applyUserInfoData = (data) => {
    if (data.success && data.registered && data.user) {
      const nextAuthMode = data.authMode
        || (apiClient.transport === 'worker' && guestSessionStore.getGuestSession()
          ? 'employee_guest'
          : 'line');
      const nextUser = {
        ...data.user,
        userId: data.user.userId,
        name: data.user.name || '',
        floor: data.user.defaultFloor || data.user.floor || '',
        defaultFloor: data.user.defaultFloor || data.user.floor || '',
        balance: Number(data.user.balance || 0),
        role: data.user.role || 'User',
        authMode: nextAuthMode,
        capabilities: Array.isArray(data.capabilities) ? data.capabilities : []
      };
      setAuthMode(nextAuthMode);
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
      setAuthMode(data.authMode || 'line');
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
  };

  const initLiffAndFetchData = (options = {}) => {
    const force = Boolean(options?.force);
    if (authBootPromiseRef.current && !force) {
      return authBootPromiseRef.current;
    }
    if (authBootPromiseRef.current && authInitInFlightRef.current) {
      logAuthDiagnostic('AUTH_BOOT_SKIPPED_IN_FLIGHT');
      return authBootPromiseRef.current;
    }
    if (authBootCompletedRef.current && !force) {
      logAuthDiagnostic('AUTH_BOOT_SKIPPED_COMPLETED');
      return Promise.resolve();
    }

    const run = (async () => {
      if (authInitInFlightRef.current) {
      logAuthDiagnostic('LIFF_INIT_SKIPPED_IN_FLIGHT');
      return;
      }

      authInitInFlightRef.current = true;
    const bootId = createBootId();
    const bootTiming = createBootTimingLogger(bootId);
    const bootStartTime = getPerformanceNow();
    let bootstrapNetworkMs = null;
    let bootStatus = 'error';
    let isFallback = false;
    let awaitingRender = false;
    let currentStage = AUTH_BOOT_STAGES.UNKNOWN;
    bootRenderPendingRef.current = null;
    bootTiming.milestone('BOOT_START');
    setLoading(true);
    setAuthState(AUTH_STATES.AUTH_LOADING);
    setAuthStage(currentStage);
    setAuthError('');
    clearIdentityData();

    try {
      let identity;
      let usingLegacyStartup = false;
      let restoredGuest = false;
      let guestSession = apiClient.transport === 'worker'
        ? guestSessionStore.getGuestSession()
        : null;
      const hasBindIntent = apiClient.transport === 'worker' && guestSessionStore.hasBindIntent();
      if (authClient.isMock) {
        currentStage = 'MOCK_IDENTITY_READY';
        setAuthStage(currentStage);
        identity = authClient.getMockIdentity();
      } else {
      if (apiClient.transport === 'worker' && guestSession && !hasBindIntent) {
        currentStage = AUTH_BOOT_STAGES.RESTORE_GUEST;
        setAuthStage(currentStage);
        logAuthDiagnostic('RESTORE_GUEST_SESSION');
        const restoredIdentity = await fetchBootstrapData(guestSession.token, bootId);
        if (restoredIdentity?.success && restoredIdentity.registered && restoredIdentity.user) {
          identity = restoredIdentity;
          restoredGuest = true;
          currentStage = AUTH_BOOT_STAGES.LIFF_CHECK;
          setAuthStage(currentStage);
          currentStage = AUTH_BOOT_STAGES.AUTH_GUEST;
          setAuthStage(currentStage);
        } else if (restoredIdentity?.code === 'GUEST_SESSION_INVALID') {
          guestSessionStore.clearGuestSession({ reason: 'restore-rejected', notify: false });
          guestSession = null;
        } else if (restoredIdentity?.code) {
          throw new Error(restoredIdentity.message || restoredIdentity.code);
        }
      }

      if (!restoredGuest) {
      if (apiClient.transport === 'worker' && guestSession && hasBindIntent) {
        currentStage = AUTH_BOOT_STAGES.RESTORE_GUEST;
        setAuthStage(currentStage);
      }
      currentStage = AUTH_BOOT_STAGES.LIFF_CHECK;
      setAuthStage(currentStage);
      logAuthDiagnostic('LIFF_INIT_START');
      bootTiming.milestone('LIFF_INIT_START');
      const liffInitStartTime = getPerformanceNow();
      try {
        await authClient.init();
      } finally {
        bootTiming.milestone('LIFF_INIT_END');
        bootTiming.metric('LIFF_INIT_MS', getPerformanceNow() - liffInitStartTime);
      }
      currentStage = 'LIFF_INIT_SUCCESS';
      setAuthStage(currentStage);
      logAuthDiagnostic(currentStage);

      const isLoggedIn = authClient.isLoggedIn();
      logAuthDiagnostic(`LIFF_IS_LOGGED_IN=${isLoggedIn}`);
      logAuthDiagnostic(`LIFF_IS_IN_CLIENT=${authClient.isInClient()}`);
      if (!isLoggedIn) {
        setAuthState(AUTH_STATES.AUTH_REQUIRED);
        setAuthStage(AUTH_STATES.AUTH_REQUIRED);
        logAuthDiagnostic('AUTH_REQUIRED');
        if (apiClient.transport !== 'worker' || hasBindIntent) authClient.login();
        return;
      }

      currentStage = 'LIFF_ACCESS_TOKEN_READ';
      setAuthStage(currentStage);
      const accessToken = authClient.getAccessToken();
      logAuthDiagnostic(`LIFF_ACCESS_TOKEN_PRESENT=${Boolean(accessToken)}`);
      if (!accessToken) {
        failAuthentication('LIFF_ACCESS_TOKEN_MISSING', 'LIFF accessToken 不存在');
        return;
      }

      if (apiClient.transport === 'worker' && hasBindIntent && guestSession?.token) {
        currentStage = AUTH_BOOT_STAGES.BIND_LINE;
        setAuthStage(currentStage);
        const bindResponse = await apiClient.bindLine({ guestToken: guestSession.token });
        if (!bindResponse.ok) throw new Error(`LINE bind HTTP ${bindResponse.status}`);
        const bindData = await bindResponse.json();
        if (!bindData.success || !bindData.user) {
          throw new Error(bindData.error || bindData.message || 'LINE bind failed');
        }
        guestSessionStore.clearBindIntent();
        guestSessionStore.clearGuestSession({ reason: 'line-bound', notify: false });
        guestSession = null;
      }

      currentStage = 'BACKEND_IDENTITY_VERIFY_START';
      setAuthStage(currentStage);
      const bootstrapRequestStartTime = getPerformanceNow();
      bootTiming.milestone('BOOTSTRAP_REQUEST_START');
      try {
        identity = await fetchBootstrapData(accessToken, bootId);
        bootTiming.backend(identity?.observability?.timing, identity?.bootId);
        usingLegacyStartup = apiClient.transport === 'gas' && identity?.code === 'INVALID_ACTION';
        if (usingLegacyStartup) {
          identity = await fetchUserInfo(accessToken);
        }
      } finally {
        bootstrapNetworkMs = getPerformanceNow() - bootstrapRequestStartTime;
        bootTiming.milestone('BOOTSTRAP_REQUEST_END');
      }
      }
      }
      if (identity?.success && identity.registered && identity.user) {
        const stateApplyStartedAt = getPerformanceNow();
        applyUserInfoData(identity);
        const canonicalUserId = identity.user.userId;
        setAuthState(AUTH_STATES.REGISTERED);
        setAuthStage('REGISTERED');
        setAuthError('');
        logAuthDiagnostic('BACKEND_IDENTITY_VERIFY_SUCCESS=true');
        logAuthDiagnostic('USER_REGISTERED=true');
        logAuthDiagnostic(`USER_ROLE=${identity.user.role || 'User'}`);
        if (usingLegacyStartup) {
          fetchUserAllOrders(canonicalUserId);
          await fetchCalendarEvents(canonicalUserId);
        } else {
          setCalendarEvents(identity.calendar?.events || {});
          setLikesLoaded(false);
          setAnnouncements([]);
          setAnnouncementsLoaded(false);
          setUserOrdersMap(identity.ordersMap || {});
        }
        bootStatus = usingLegacyStartup ? 'fallback' : 'success';
        isFallback = usingLegacyStartup;
        bootRenderPendingRef.current = {
          timing: bootTiming,
          startedAt: bootStartTime,
          stateApplyStartedAt,
          status: bootStatus,
          fallback: isFallback,
          bootstrapNetworkMs,
          bootId,
          deferredUi: !usingLegacyStartup,
          deferredUiGeneration: deferredUiGenerationRef.current
        };
        awaitingRender = true;
      } else if (identity?.success && identity.registered === false) {
        const stateApplyStartedAt = getPerformanceNow();
        applyUserInfoData(identity);
        setAuthState(AUTH_STATES.UNREGISTERED);
        setAuthStage('UNREGISTERED');
        setAuthError('');
        logAuthDiagnostic('BACKEND_IDENTITY_VERIFY_SUCCESS=true');
        logAuthDiagnostic('USER_REGISTERED=false');
        bootStatus = usingLegacyStartup ? 'fallback' : 'success';
        isFallback = usingLegacyStartup;
        bootRenderPendingRef.current = {
          timing: bootTiming,
          startedAt: bootStartTime,
          stateApplyStartedAt,
          status: bootStatus,
          fallback: isFallback,
          bootstrapNetworkMs
        };
        awaitingRender = true;
      } else {
        logAuthDiagnostic('BACKEND_IDENTITY_VERIFY_SUCCESS=false');
        failAuthentication('BACKEND_IDENTITY_VERIFY_FAILED', identity?.message || 'backend 未回傳有效身份狀態');
      }
    } catch (err) {
      failAuthentication(currentStage, err);
    } finally {
      setLoading(false);
      if (!awaitingRender) {
        if (typeof bootstrapNetworkMs === 'number') {
          bootTiming.metric('BOOTSTRAP_NETWORK_MS', bootstrapNetworkMs, bootStatus, isFallback);
        }
        bootTiming.metric('BOOT_TOTAL_MS', getPerformanceNow() - bootStartTime, bootStatus, isFallback);
      }
        authInitInFlightRef.current = false;
        authBootCompletedRef.current = true;
      }
    })();

    authBootPromiseRef.current = run;
    run.then(
      () => {
        if (authBootPromiseRef.current === run) authBootPromiseRef.current = null;
      },
      () => {
        if (authBootPromiseRef.current === run) authBootPromiseRef.current = null;
      }
    );
    return run;
  };

  useEffect(() => {
    const pendingBoot = bootRenderPendingRef.current;
    if (!pendingBoot || loading) return;
    if (authState !== AUTH_STATES.REGISTERED && authState !== AUTH_STATES.UNREGISTERED) return;

    bootRenderPendingRef.current = null;
    pendingBoot.timing.milestone('BOOTSTRAP_STATE_READY');
    if (typeof pendingBoot.bootstrapNetworkMs === 'number') {
      pendingBoot.timing.metric(
        'BOOTSTRAP_NETWORK_MS',
        pendingBoot.bootstrapNetworkMs,
        pendingBoot.status,
        pendingBoot.fallback
      );
    }
    pendingBoot.timing.metric(
      'STATE_APPLY_MS',
      getPerformanceNow() - pendingBoot.stateApplyStartedAt,
      pendingBoot.status,
      pendingBoot.fallback
    );
    pendingBoot.timing.milestone('BOOT_READY');
    pendingBoot.timing.metric(
      'BOOT_TOTAL_MS',
      getPerformanceNow() - pendingBoot.startedAt,
      pendingBoot.status,
      pendingBoot.fallback
    );

    if (pendingBoot.deferredUi && deferredUiBootRef.current !== pendingBoot.bootId) {
      deferredUiBootRef.current = pendingBoot.bootId;
      const deferredGeneration = pendingBoot.deferredUiGeneration;
      const accessToken = readCurrentCredential();
      void fetchDeferredBootstrapData(accessToken, pendingBoot.bootId)
        .then((data) => {
          if (deferredGeneration !== deferredUiGenerationRef.current) return;

          pendingBoot.timing.deferredBackend(data?.observability?.timing, data?.bootId);
          if (data?.bootId !== pendingBoot.bootId) {
            setAnnouncementsLoaded(true);
            logAuthDiagnostic('DEFERRED_UI_RESPONSE_MISMATCH');
            return;
          }
          if (!data?.success) {
            setAnnouncementsLoaded(true);
            logAuthDiagnostic('DEFERRED_UI_REQUEST_FAILED');
            return;
          }

          const nextLikes = normalizeDeferredLikes(data.likes);
          const nextAnnouncements = normalizeDeferredAnnouncements(data.announcements);
          if (nextLikes !== null) {
            setCalendarEvents(prev => mergeDeferredLikes(prev, nextLikes));
            setLikesLoaded(true);
          }
          if (nextAnnouncements !== null) {
            setAnnouncements(nextAnnouncements);
            setAnnouncementsLoaded(true);
          } else {
            setAnnouncementsLoaded(true);
            logAuthDiagnostic('DEFERRED_UI_RESPONSE_INVALID');
          }
        })
        .catch(() => {
          if (deferredGeneration !== deferredUiGenerationRef.current) return;
          setAnnouncementsLoaded(true);
          logAuthDiagnostic('DEFERRED_UI_REQUEST_FAILED');
        });
    }
  }, [authState, authUser, authMode, calendarEvents, userOrdersMap, announcements, loading, readCurrentCredential]);

  useEffect(() => {
    const unsubscribe = guestSessionStore.subscribe((event) => {
      if (event?.type !== 'guest-session-invalid') return;
      authBootCompletedRef.current = false;
      setAuthState(AUTH_STATES.AUTH_REQUIRED);
      setAuthStage(AUTH_BOOT_STAGES.RESTORE_GUEST);
      setAuthError('員工登入已失效，請重新輸入員工編號。');
      clearIdentityData();
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    void initLiffAndFetchData();
  }, []);

  const canManageAdminAnnouncements = () => (
    apiClient.transport === 'worker'
    && authState === AUTH_STATES.REGISTERED
    && Boolean(authUser?.userId)
    && !viewAsUser
    && hasPermission(authUser?.role, 'manageAnnouncements', authMode)
  );

  const loadAdminAnnouncements = async (force = false) => {
    if (!canManageAdminAnnouncements()) return;
    if (!force && adminAnnouncementsLoaded) return;

    const requestId = ++adminAnnouncementsRequestRef.current;
    setAdminAnnouncementsLoading(true);
    setAdminAnnouncementsError('');

    try {
      const accessToken = readCurrentCredential();
      if (!accessToken) {
        setAdminAnnouncementsError('目前無法驗證身份，請重新登入後再試。');
        return;
      }
      const res = await apiClient.getAdminAnnouncements();
      const data = await res.json();
      if (requestId !== adminAnnouncementsRequestRef.current) return;

      if (!Array.isArray(data.announcements)) {
        setAdminAnnouncementsError('目前無法取得公告清單，請稍後再試。');
        return;
      }
      setAdminAnnouncements(data.announcements);
      setAdminAnnouncementsLoaded(true);
    } catch (error) {
      if (requestId === adminAnnouncementsRequestRef.current) {
        setAdminAnnouncementsError(error?.code
          ? `目前無法取得公告清單（${error.code}），請稍後再試。`
          : '目前無法取得公告清單，請稍後再試。');
      }
    } finally {
      if (requestId === adminAnnouncementsRequestRef.current) setAdminAnnouncementsLoading(false);
    }
  };

  const assertAdminAnnouncementMutationAllowed = () => {
    if (!canManageAdminAnnouncements()) {
      throw new Error('公告管理僅限已驗證的 Admin 使用。');
    }
  };

  const createAdminAnnouncement = async (payload) => {
    assertAdminAnnouncementMutationAllowed();
    await apiClient.createAdminAnnouncement(payload);
  };

  const updateAdminAnnouncement = async (id, payload) => {
    assertAdminAnnouncementMutationAllowed();
    await apiClient.updateAdminAnnouncement(id, payload);
  };

  const deleteAdminAnnouncement = async (id) => {
    assertAdminAnnouncementMutationAllowed();
    await apiClient.deleteAdminAnnouncement(id);
  };

  const loadAdminSummary = async (targetDate, viewAsUserId = null, shouldShowView) => {
    if (!authUserId || !targetDate) return;

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
      const accessToken = readCurrentCredential();
      if (!accessToken) {
        setAdminSummaryError('目前無法驗證身份，請重新登入後再試。');
        return;
      }
      const res = await apiClient.getAdminSummary({
        targetDate,
        includeMemberBalances: false,
        viewAsUserId
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

  const loadMemberBalances = async (force = false) => {
    const visibleRole = viewAsUser?.role || authUser?.role;
    if (!authUser?.userId || !hasPermission(visibleRole, 'viewMemberBalances', authMode)) return;
    if (!force && memberBalancesLoaded) return;

    const requestId = ++memberBalancesRequestRef.current;
    setMemberBalancesLoading(true);
    setMemberBalancesError('');

    try {
      const accessToken = readCurrentCredential();
      if (!accessToken) {
        setMemberBalancesError('目前無法驗證身份，請重新登入後再試。');
        return;
      }
      const res = await apiClient.getMemberBalances();
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
    const requestStartTime = getPerformanceNow();
    try {
      if (!accessToken) {
        return { success: false, message: 'LIFF accessToken 不存在' };
      }

      const res = await apiClient.getIdentity();
      if (!res.ok) {
        return { success: false, message: `backend HTTP ${res.status}` };
      }
      const data = await res.json();
      return applyUserInfoData(data);
    } catch (err) {
      const safeMessage = redactAuthSecrets(err instanceof Error ? err.message : err);
      logAuthDiagnostic(`BACKEND_IDENTITY_VERIFY_SUCCESS=false stage=BACKEND_IDENTITY_VERIFY_REQUEST error=${safeMessage}`);
      return { success: false, message: safeMessage };
    } finally {
      logPerformanceTiming('GET_USER_INFO', requestStartTime);
    }
  };

  const handleRegister = async () => {
    if (registrationLoading || authState !== AUTH_STATES.UNREGISTERED) return;

    const accessToken = authClient.getAccessToken();
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
      const res = await apiClient.register({ pickupFloor: registrationFloor });
      if (!res.ok) {
        throw new Error(`backend HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!data.success) {
        await showPopup({ icon: 'error', title: '註冊失敗', text: data.message || '目前無法完成註冊，請稍後再試。' });
        return;
      }

      // Backend 會回傳 canonical row；這裡再重新取得一次，確保後續狀態來自 Users。
      const canonicalAccessToken = authClient.getAccessToken();
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

  const handleEmployeeGuestLogin = async (event) => {
    event?.preventDefault?.();
    if (
      apiClient.transport !== 'worker'
      || employeeGuestLoading
      || employeeGuestRequestRef.current
    ) return;

    const employeeId = String(employeeGuestId || '').trim();
    if (!employeeId) {
      setEmployeeGuestError('請輸入員工編號。');
      return;
    }

    employeeGuestRequestRef.current = true;
    setEmployeeGuestLoading(true);
    setEmployeeGuestError('');
    setAuthError('');
    try {
      const response = await apiClient.employeeGuestLogin({ employeeId });
      const data = await response.json();
      if (!data.success || data.authMode !== 'employee_guest' || !data.token || !data.expiresAt) {
        throw new Error(data.error || data.message || 'EMPLOYEE_GUEST_LOGIN_INVALID_RESPONSE');
      }
      guestSessionStore.setGuestSession({ token: data.token, expiresAt: data.expiresAt });
      authBootCompletedRef.current = false;
      setEmployeeGuestId('');
      await initLiffAndFetchData({ force: true });
    } catch (error) {
      setEmployeeGuestError(getApiErrorPresentation(error, '員工登入').message);
    } finally {
      employeeGuestRequestRef.current = false;
      setEmployeeGuestLoading(false);
    }
  };

  const handleLineLogin = async () => {
    if (lineBindLoading || employeeGuestLoading) return;
    try {
      await authClient.init();
      if (!authClient.isLoggedIn()) {
        authClient.login();
        return;
      }
      authBootCompletedRef.current = false;
      await initLiffAndFetchData({ force: true });
    } catch (error) {
      failAuthentication('LIFF_LOGIN_REQUEST_FAILED', error);
    }
  };

  const handleBindLine = async () => {
    if (apiClient.transport !== 'worker' || lineBindLoading) return;
    const guestSession = guestSessionStore.getGuestSession();
    if (!guestSession) {
      setEmployeeGuestError('員工登入已失效，請重新輸入員工編號。');
      setAuthState(AUTH_STATES.AUTH_REQUIRED);
      return;
    }

    guestSessionStore.setBindIntent();
    authBootCompletedRef.current = false;
    setLineBindLoading(true);
    setEmployeeGuestError('');
    setAuthError('');
    try {
      await authClient.init();
      if (!authClient.isLoggedIn()) {
        setAuthState(AUTH_STATES.AUTH_REQUIRED);
        setAuthStage(AUTH_BOOT_STAGES.LIFF_CHECK);
        authClient.login();
        return;
      }

      const response = await apiClient.bindLine({ guestToken: guestSession.token });
      const data = await response.json();
      if (!data.success || !data.user) {
        throw new Error(data.error || data.message || 'LINE_BIND_FAILED');
      }
      guestSessionStore.clearBindIntent();
      guestSessionStore.clearGuestSession({ reason: 'line-bound', notify: false });
      authBootCompletedRef.current = false;
      await initLiffAndFetchData({ force: true });
    } catch (error) {
      guestSessionStore.clearBindIntent();
      setEmployeeGuestError(getApiErrorPresentation(error, '綁定 LINE').message);
    } finally {
      setLineBindLoading(false);
    }
  };

  const fetchCalendarEvents = async (uId, viewAsUserId = null) => {
    const targetId = uId || authUserId;
    if (!targetId) return false;
    const requestStartTime = getPerformanceNow();
    try {
      const res = await apiClient.getCalendar({
        userId: targetId,
        viewAsUserId: apiClient.transport === 'worker' ? viewAsUserId : null
      });
      const data = await res.json();
      if (data.success) {
        setCalendarEvents(data.events || {});
        setLikesLoaded(true);
        // announcements is canonical; the singular fallback supports the deployment transition.
        const nextAnnouncements = Array.isArray(data.announcements)
          ? data.announcements
          : (data.announcement ? [data.announcement] : []);
        setAnnouncements(nextAnnouncements);
        setAnnouncementsLoaded(true);
        return true;
      }
      return false;
    } catch (err) {
      console.error("無法讀取月曆資料", err);
      return false;
    } finally {
      logPerformanceTiming('CALENDAR', requestStartTime);
    }
  };

  const fetchUserAllOrders = async (uId, viewAsUserId = null) => {
    if (!uId) return false;
    const requestStartTime = getPerformanceNow();
    try {
      const res = await apiClient.getOrdersMap({
        userId: uId,
        viewAsUserId: apiClient.transport === 'worker' ? viewAsUserId : null
      });
      const data = await res.json();
      if (data.success) {
        setUserOrdersMap(data.ordersMap || {});
        return true;
      }
      return false;
    } catch (err) {
      console.error("讀取個人訂單圖譜失敗", err);
      return false;
    } finally {
      logPerformanceTiming('ORDERS_MAP', requestStartTime);
    }
  };

  const loadBalanceHistory = async (year, month, viewAsUserId = null) => {
    if (authState !== AUTH_STATES.REGISTERED || !authUserId) return;

    const requestId = ++historyRequestRef.current;
    setHistoryLoading(true);
    setHistoryError('');
    setHistoryList([]);
    setHistorySummary({ openingBalance: 0, totalCredit: 0, totalDebit: 0, closingBalance: 0 });

    try {
      const accessToken = readCurrentCredential();
      if (!accessToken) {
        setHistoryError('目前無法驗證身份，請重新登入後再試。');
        return;
      }
      const res = await apiClient.getBalanceHistory({ year, month, viewAsUserId });
      const data = await res.json();
      if (requestId !== historyRequestRef.current) return;

      if (data.success && data.openingBalancePolicyRequired) {
        setHistoryError('目前餘額歷史仍受開戶餘額政策限制，請待政策確認後再試。');
      } else if (data.success) {
        setHistoryList(data.transactions || []);
        setHistorySummary({
          openingBalance: data.openingBalance ?? 0,
          totalCredit: data.totalCredit ?? 0,
          totalDebit: data.totalDebit ?? 0,
          closingBalance: data.closingBalance ?? 0
        });
      } else {
        setHistoryError('目前無法讀取此月份的交易明細，請稍後再試。');
      }
    } catch (error) {
      if (requestId === historyRequestRef.current) {
        setHistoryError(error?.code === 'OPENING_BALANCE_POLICY_REQUIRED'
          ? '目前餘額歷史仍受開戶餘額政策限制，請待政策確認後再試。'
          : '目前無法讀取此月份的交易明細，請稍後再試。');
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
    loadBalanceHistory(currentMonth.year, currentMonth.month, viewAsUser?.userId || null);
  };

  const shiftHistoryMonth = (offset) => {
    if (historyLoading) return;
    const nextMonth = shiftYearMonth(selectedYear, selectedMonth, offset);
    setSelectedYear(nextMonth.year);
    setSelectedMonth(nextMonth.month);
    loadBalanceHistory(nextMonth.year, nextMonth.month, viewAsUser?.userId || null);
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
    if (!likesLoaded) return;
    const workerLikeMutation = apiClient.transport === 'worker';
    if (workerLikeMutation && likeMutationInFlightRef.current) return;
    if (workerLikeMutation) {
      likeMutationInFlightRef.current = true;
      setLikeMutationInFlight(true);
    }

    const previousEvent = calendarEvents[dateStr];
    const rollbackOptimisticLike = () => {
      setCalendarEvents(prev => restoreCalendarEvent(prev, dateStr, previousEvent));
    };

    try {
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

      const res = await apiClient.toggleLike({ date: dateStr, userId: authUserId });
      const data = await res.json();
      if (workerLikeMutation) {
        const authoritative = normalizeWorkerLikeResponse(data);
        if (!authoritative) {
          rollbackOptimisticLike();
          console.error("愛心回應格式錯誤", { code: 'LIKE_RESPONSE_INVALID' });
          await fetchCalendarEvents();
          return;
        }
        setCalendarEvents(prev => ({
          ...prev,
          [dateStr]: {
            ...(prev[dateStr] || {}),
            isUserLiked: authoritative.isLiked,
            likeCount: authoritative.likeCount
          }
        }));
        await fetchCalendarEvents(); // 刷新同步後端開團狀態
      } else if (data.success) {
        fetchCalendarEvents(); // 刷新同步後端開團狀態
      } else {
        return;
      }
    } catch (err) {
      if (workerLikeMutation) {
        rollbackOptimisticLike();
        await fetchCalendarEvents();
      }
      console.error("按讚失敗", err);
      if (!workerLikeMutation) fetchCalendarEvents(); // 失敗則還原
    } finally {
      if (workerLikeMutation) {
        likeMutationInFlightRef.current = false;
        setLikeMutationInFlight(false);
      }
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
    clearClientRequestKey(orderSubmitRequestRef);
    clearClientRequestKey(orderCancelRequestRef);
    setLoading(true);
    setMessage('');
    setShowCancelConfirmation(false);
    setCancelError('');
    setOrderNote('');
    setOrderItems({});
    setActiveOrderSnapshot(null);
    setActiveOrderId('');
    setHasExistingOrder(false);

    try {
      const res = await apiClient.getOrderPage({
        targetDate: dateStr,
        userId: authUserId,
        viewAsUserId: apiClient.transport === 'worker' ? viewAsUser?.userId : null
      });
      const data = await res.json();
      if (data.success && data.myOrder && Array.isArray(data.myOrder.items)) {
        const workerOrderMode = apiClient.transport === 'worker';
        const orderMap = {};
        data.myOrder.items.forEach(item => {
          const selectionId = workerOrderMode
            ? item.menu_item_id || item.item_id
            : item.item_id;
          orderMap[selectionId] = item.quantity;
        });

        setSetting(data.setting);
        setDeadline(data.deadline);
        setMenu(workerOrderMode ? normalizeWorkerOrderMenu(data.menu) : data.menu);
        setImageLoadErrors({});
        setOrderItems(orderMap);
        setActiveOrderSnapshot(buildExistingOrderSubmission({
          order: data.myOrder,
          selectedDate: dateStr,
          vendor: data.setting?.vendor || '',
          fallbackFloor: defaultFloor || authUser?.defaultFloor || authUser?.floor || floor
        }));
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
      const res = await apiClient.setCalendarVendor({ adminUserId: authUserId, dateStr, vendor });
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
    if (loading || orderMutationInFlightRef.current || authState !== AUTH_STATES.REGISTERED || !authUserId) return;
    if (!(await guardWrite('訂單送出'))) return;
    if (isExpired) {
      await showPopup({ icon: 'warning', title: '已截止訂餐', text: '該日期已截止訂餐！' });
      return;
    }
    if (orderSubmission.items.length === 0) {
      await showPopup({ icon: 'warning', title: '尚未選擇餐點', text: '請至少選擇一份便購' });
      return;
    }
    setShowOrderConfirmation(true);
  };

  const handleConfirmSubmit = async () => {
    if (!showOrderConfirmation || loading || orderMutationInFlightRef.current || authState !== AUTH_STATES.REGISTERED || !authUserId) return;
    orderMutationInFlightRef.current = true;
    try {
      if (!(await guardWrite('訂單送出'))) return;
      if (isExpired) {
        setShowOrderConfirmation(false);
        await showPopup({ icon: 'warning', title: '已截止訂餐', text: '該日期已截止訂餐！' });
        return;
      }
      if (orderSubmission.items.length === 0) {
        setShowOrderConfirmation(false);
        await showPopup({ icon: 'warning', title: '尚未選擇餐點', text: '請至少選擇一份便購' });
        return;
      }

      const workerOrderMutation = apiClient.transport === 'worker';
      const requestKey = workerOrderMutation
        ? getStableClientRequestKey(orderSubmitRequestRef, 'order', {
          targetDate: orderSubmission.targetDate,
          pickupFloor: orderSubmission.pickupFloor,
          items: orderSubmission.items.map(({ item_id, quantity }) => ({ item_id, quantity })),
          note: orderSubmission.note.trim()
        })
        : null;

      setLoading(true);
      try {
        const res = await apiClient.submitOrder({
          userId: authUserId,
          pickup_floor: orderSubmission.pickupFloor,
          target_date: orderSubmission.targetDate,
          items: orderSubmission.items,
          note: orderSubmission.note,
          ...(workerOrderMutation ? { idempotencyKey: requestKey } : {})
        });
        const data = await res.json();
        if (data.success) {
          setShowOrderConfirmation(false);
          setMessage('✅ 下單成功');
          setHasExistingOrder(true);
          if (data.newBalance !== undefined) {
            setUserBalance(data.newBalance);
          }
          setActiveOrderId(data.orderId || '');
          clearClientRequestKey(orderSubmitRequestRef);
          clearClientRequestKey(orderCancelRequestRef);
          await Promise.all([
            fetchCalendarEvents(authUserId),
            fetchUserAllOrders(authUserId)
          ]);
          handleExitToCalendar();
          void showToast({ icon: 'success', title: '下單成功' });
        } else {
          setMessage(`❌ ${data.message || '下單失敗'}`);
        }
      } catch (err) {
        setMessage(`❌ ${getApiErrorPresentation(err, '送出訂單').message}`);
      } finally {
        setLoading(false);
      }
    } finally {
      orderMutationInFlightRef.current = false;
    }
  };

  const handleCancelOrder = async () => {
    if (
      loading
      || showCancelConfirmation
      || orderMutationInFlightRef.current
      || authState !== AUTH_STATES.REGISTERED
      || !activeOrderId
      || !authUserId
    ) return;
    if (!(await guardWrite('取消訂單'))) return;
    if (isExpired) {
      await showPopup({ icon: 'warning', title: '無法取消訂購', text: '已過截止時間，無法取消訂購！' });
      return;
    }
    setCancelError('');
    setShowCancelConfirmation(true);
  };

  const handleConfirmCancel = async () => {
    if (
      !showCancelConfirmation
      || loading
      || orderMutationInFlightRef.current
      || authState !== AUTH_STATES.REGISTERED
      || !activeOrderId
      || !authUserId
    ) return;
    orderMutationInFlightRef.current = true;
    try {
      if (!(await guardWrite('取消訂單'))) return;
      if (isExpired) {
        setShowCancelConfirmation(false);
        await showPopup({ icon: 'warning', title: '無法取消訂購', text: '已過截止時間，無法取消訂購！' });
        return;
      }

      const orderId = activeOrderId;
      const workerOrderMutation = apiClient.transport === 'worker';
      const cancelRequestKey = workerOrderMutation
        ? getStableClientRequestKey(orderCancelRequestRef, 'cancel', {
          orderId,
          targetDate: selectedDate
        })
        : null;

      setCancelError('');
      setLoading(true);
      try {
        const res = await apiClient.cancelOrder({
          userId: authUserId,
          orderId,
          date: selectedDate,
          ...(workerOrderMutation ? { idempotencyKey: cancelRequestKey } : {})
        });
        const data = await res.json();
        if (!data.success) {
          setCancelError(getApiErrorPresentation({
            kind: 'business',
            code: data.error || data.code || data.message,
            status: res.status
          }, '取消訂單').message);
          return;
        }

        if (data.newBalance !== undefined && data.newBalance !== null) {
          setUserBalance(data.newBalance);
          setAuthUser(prev => prev ? { ...prev, balance: data.newBalance } : prev);
        }
        const [calendarRefreshed, ordersRefreshed] = await Promise.all([
          fetchCalendarEvents(authUserId),
          fetchUserAllOrders(authUserId)
        ]);
        if (!calendarRefreshed || !ordersRefreshed) {
          setCancelError('取消訂單已完成，但最新資料更新失敗，請稍後重試。');
          return;
        }

        setShowCancelConfirmation(false);
        await showPopup({
          icon: 'success',
          title: '取消訂單完成',
          text: '訂單已取消並完成退款。'
        });
        handleExitToCalendar();
      } catch (err) {
        setCancelError(getApiErrorPresentation(err, '取消訂單').message);
      } finally {
        setLoading(false);
      }
    } finally {
      orderMutationInFlightRef.current = false;
    }
  };

  const handleExitToCalendar = () => {
    setSelectedDate(null);
    setActiveOrderId('');
    setOrderItems({});
    setActiveOrderSnapshot(null);
    setOrderNote('');
    setMessage('');
    setHasExistingOrder(false);
    setShowCancelConfirmation(false);
    setCancelError('');
    clearClientRequestKey(orderSubmitRequestRef);
    clearClientRequestKey(orderCancelRequestRef);
    setViewMode('calendar');
  };

  const handleAdminDateChange = (dateStr) => {
    if (!dateStr || authState !== AUTH_STATES.REGISTERED || !authUserId || !can('viewAdminOrderSummary')) return;
    setSelectedOrderDate(dateStr);
    loadAdminSummary(dateStr, viewAsUser?.userId || null, true);
  };

  const handleAdminSectionChange = (section) => {
    if (section === 'orders') {
      if (!can('viewAdminOrderSummary')) return;
      setAdminSection('orders');
      loadAdminSummary(selectedOrderDate, viewAsUser?.userId || null, true);
      return;
    }

    if (section === 'balances') {
      if (!can('viewMemberBalances')) return;
      setAdminSection('balances');
      setViewMode('admin');
      loadMemberBalances();
      return;
    }

    if (section === 'announcements') {
      if (!canManageAdminAnnouncements() || isViewAsMode) return;
      setAdminSection('announcements');
      setViewMode('admin');
      void loadAdminAnnouncements(true);
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
    if (apiClient.transport === 'worker') {
      void fetchCalendarEvents(user.userId, user.userId);
      void fetchUserAllOrders(user.userId, user.userId);
    }
    if (hasPermission(user.role, 'viewAdminOrderSummary', authMode)) {
      setAdminSection('orders');
      setViewMode('admin');
      loadAdminSummary(selectedOrderDate, user.userId, true);
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
    if (apiClient.transport === 'worker') {
      void fetchCalendarEvents(authUserId, null);
      void fetchUserAllOrders(authUserId, null);
    }
    setAdminSection('orders');
    if (hasPermission(authUser?.role, 'viewAdminOrderSummary', authMode)) {
      setViewMode('admin');
      loadAdminSummary(selectedOrderDate, null, true);
    } else {
      setViewMode('calendar');
    }
  };

  const handleOpenFloorModal = () => {
    if (!isRegistered || isViewAsMode || !authUser) return;
    setFloorDraft(authUser.defaultFloor || authUser.floor || defaultFloor || '1樓');
    setFloorError('');
    setShowFloorModal(true);
  };

  const handleSaveDefaultFloor = async () => {
    if (!authUser || isViewAsMode || floorLoading) return;

    const nextFloor = String(floorDraft || '').trim();
    if (!['1樓', '9樓'].includes(nextFloor)) {
      setFloorError('預設領取樓層只允許 1樓 或 9樓');
      return;
    }

    const accessToken = readCurrentCredential();
    if (!accessToken) {
      setFloorError('目前無法驗證身份，請重新登入後再試。');
      return;
    }

    setFloorLoading(true);
    setFloorError('');
    try {
      const res = await apiClient.updatePickupFloor({ pickupFloor: nextFloor });
      if (!res.ok) {
        setFloorError(`更新失敗（HTTP ${res.status}）`);
        return;
      }

      const data = await res.json();
      if (!data.success || !data.user) {
        setFloorError(data.message || '目前無法更新預設領取樓層，請稍後再試。');
        return;
      }

      const canonicalFloor = data.user.defaultFloor || data.user.floor || nextFloor;
      setAuthUser(prev => prev ? {
        ...prev,
        ...data.user,
        floor: canonicalFloor,
        defaultFloor: canonicalFloor
      } : prev);
      setDefaultFloor(canonicalFloor);
      if (!hasExistingOrder) setFloor(canonicalFloor);
      setShowFloorModal(false);
    } catch {
      setFloorError('目前無法更新預設領取樓層，請稍後再試。');
    } finally {
      setFloorLoading(false);
    }
  };

  const handleImagePreview = (imageUrl, alt) => {
    if (!imageUrl) return;
    setImagePreview({ imageUrl, alt: alt || '餐點圖片' });
  };

  const handleOpenTopupModal = (user) => {
    setSelectedTopupUser(user);
    setTopupAmount('');
    setTopupNote('現金收款');
    setTopupIdempotencyKey(createClientRequestKey('topup'));
  };

  const handleTopupSubmit = async () => {
    if (!selectedTopupUser || topupLoading || !can('topupMember')) return;
    if (!(await guardWrite('儲值'))) return;

    const amountText = String(topupAmount).trim();
    const amount = Number(amountText);
    const workerTopUp = apiClient.transport === 'worker';
    const validAmount = workerTopUp
      ? Number.isSafeInteger(amount) && amount > 0
      : Number.isFinite(amount) && amount > 0;
    if (!amountText || !validAmount) {
      await showPopup({
        icon: 'warning',
        title: '金額不正確',
        text: workerTopUp ? '儲值金額必須是大於 0 的整數。' : '儲值金額必須大於 0。'
      });
      return;
    }

    const requestKey = topupIdempotencyKey || createClientRequestKey('topup');
    if (!topupIdempotencyKey) setTopupIdempotencyKey(requestKey);
    setTopupLoading(true);
    try {
      const res = await apiClient.topUpBalance({
        adminUserId: authUserId,
        targetUserId: selectedTopupUser.userId,
        amount,
        note: topupNote.trim(),
        idempotencyKey: requestKey
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
      setTopupIdempotencyKey('');
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
    const firstWeekdayColumn = getWeekdayLeadingBlankCount(year, month);
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
            statusBg = "bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200 cursor-pointer";
            statusBadge = <span className="text-[9px] bg-slate-300 border border-slate-400 text-slate-700 px-1 py-0.5 rounded font-medium">已截止</span>;
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
            {likesLoaded ? (
              <button
                onClick={(e) => handleToggleLike(e, dateStr)}
                disabled={isViewAsMode || likeMutationInFlight}
                className="flex items-center gap-0.5 text-xs focus:outline-none hover:scale-110 transition-transform disabled:cursor-not-allowed disabled:opacity-50"
                title="點愛心開蔡老師團"
              >
                <span>{event?.isUserLiked ? '❤️' : '🤍'}</span>
                <span className={`text-[10px] font-bold ${event?.likeCount > 0 ? 'text-rose-600' : 'text-gray-400'}`}>
                  {event?.likeCount || 0}
                </span>
              </button>
            ) : (
              <span
                aria-label="Like status loading"
                className="flex h-4 w-8 items-center justify-center text-xs text-gray-300"
              >
                …
              </span>
            )}

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

        const eventClassName = eventExpired
          ? 'w-full text-left bg-slate-100 border border-slate-300 hover:bg-slate-200 rounded-xl p-3 transition-colors'
          : 'w-full text-left bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-xl p-3 transition-colors';
        const eventDateClassName = eventExpired
          ? 'font-bold text-sm text-slate-800'
          : 'font-bold text-sm text-emerald-900';

        return (
          <button
            key={dateStr}
            type="button"
            onClick={() => handleSelectDate(dateStr)}
            className={eventClassName}
          >
            <div className="flex justify-between items-center gap-3">
              <span className={eventDateClassName}>
                {date.getMonth() + 1}/{date.getDate()}（{weekdayLabels[date.getDay()]}）
              </span>
              <div className="flex items-center gap-2 text-xs">
                {event.likeCount > 0 && <span className="text-rose-600 font-bold">❤️ {event.likeCount}</span>}
                <span className={eventExpired ? 'bg-slate-500 text-white px-2 py-1 rounded-lg font-bold' : 'bg-emerald-600 text-white px-2 py-1 rounded-lg font-bold'}>
                  {eventExpired ? '已截止' : '預訂'}
                </span>
              </div>
            </div>
            <div className="text-xs text-gray-700 font-bold mt-1">{event.vendor}</div>
          </button>
        );
      });
  };

  const workerOrderMutation = apiClient.transport === 'worker';
  const orderSubmission = buildOrderSubmission({
    menu,
    orderItems,
    selectedDate,
    vendor: setting?.vendor || '',
    floor,
    note: orderNote,
    workerOrderMutation
  });
  const { totalCount, totalAmount } = orderSubmission;

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
  const can = (permission) => isRegistered && hasPermission(effectiveRole, permission, authMode);
  const canAuth = (permission) => isRegistered && hasPermission(authRole, permission, authMode);
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
    <div className="flex min-h-screen min-w-0 flex-col bg-[#F7F5F0] pb-24 text-gray-800">
      <header className="bg-[#2C4A3E] text-white p-4 shadow-md">
        <div className="max-w-xl mx-auto min-w-0">
          <div className="flex min-w-0 items-center">
            <h1 className="text-xl font-bold">蔬食便當預訂系統</h1>
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-emerald-100">
            <span>👤 {displayName}</span>
            {effectiveUser && isRegistered && (
              <span className="rounded bg-emerald-800/80 px-1.5 py-0.5">
                {authMode === 'employee_guest' ? '員編登入' : effectiveRole}
              </span>
            )}
            <DevAuthBadge mode={authClient.mode} mockUser={authClient.mockUser} />
            {displayFloor && (isViewAsMode ? (
              <span className="rounded bg-emerald-900/80 px-1.5 py-0.5 font-bold text-emerald-100" aria-label={`目前預設領取樓層 ${displayFloor}`}>
                {displayFloor}
              </span>
            ) : (
              <button
                type="button"
                onClick={handleOpenFloorModal}
                aria-label={`修改預設領取樓層，目前為 ${displayFloor}`}
                className="rounded bg-emerald-900/80 px-1.5 py-0.5 font-bold text-emerald-100 transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-300"
              >
                {displayFloor}
              </button>
            ))}
            {isRegistered && !isViewAsMode && can('viewOwnBalance') && (
              <button
                type="button"
                onClick={fetchBalanceHistory}
                className="inline-flex items-center gap-1 rounded text-xs text-emerald-200 hover:underline focus:outline-none"
              >
                <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${displayBalance < 0 ? 'bg-red-900/80 text-red-200' : 'bg-emerald-900/80 text-yellow-300'}`}>
                  {formatBalanceAmount(displayBalance)}
                </span>
              </button>
            )}
            {isRegistered
              && apiClient.transport === 'worker'
              && authMode === 'employee_guest'
              && !isViewAsMode
              && (
                <button
                  type="button"
                  onClick={handleBindLine}
                  disabled={lineBindLoading}
                  className="rounded bg-emerald-800/80 px-2 py-1 text-xs font-bold text-emerald-100 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {lineBindLoading ? '綁定中...' : '綁定 LINE'}
                </button>
              )}
          </div>
          <ViewAsBanner
            viewAsUser={isViewAsMode ? viewAsUser : null}
            displayBalance={displayBalance}
            onExit={handleExitViewAs}
          />
          <div aria-label="功能操作" className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
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
            {isRegistered && apiClient.transport === 'worker' && canAuth('manageAnnouncements') && !isViewAsMode && (
              <button
                type="button"
                onClick={() => handleAdminSectionChange('announcements')}
                className={`text-xs px-2.5 py-1.5 rounded-lg transition shadow-sm font-bold ${viewMode === 'admin' && adminSection === 'announcements' ? 'bg-amber-600 text-white' : 'bg-emerald-800 text-emerald-100'}`}
              >
                📢 公告管理
              </button>
            )}
            {isRegistered && can('manageCalendar') && (
              <button
                type="button"
                onClick={adminManageMode ? handleToggleAdminManage : openAdminCalendar}
                disabled={isViewAsMode}
                className={`text-xs px-2.5 py-1.5 rounded-lg transition shadow-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${adminManageMode ? 'bg-rose-600 text-white' : 'bg-emerald-800 text-emerald-100'}`}
              >
                {adminManageMode ? '🔒 離開開團' : '📅 開團'}
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

      <main className="w-full max-w-xl min-w-0 mx-auto flex-1 p-4">
        {isRegistered && viewMode === 'calendar' && !loading && (
          <div className="mb-4 min-h-[3rem]">
            {announcementsLoaded && announcements[0] ? (
              <AnnouncementBar
                announcement={announcements[0]}
                onClick={() => setShowAnnouncementModal(true)}
              />
            ) : !announcementsLoaded ? (
              <div
                aria-label="Announcements loading"
                className="h-12 rounded-2xl border border-transparent"
              />
            ) : null}
          </div>
        )}

        {apiClient.transport === 'worker'
          && [AUTH_STATES.AUTH_REQUIRED, AUTH_STATES.AUTH_FAILED, AUTH_STATES.UNREGISTERED].includes(authState)
          && !loading
          && (
            <EmployeeGuestLogin
              employeeId={employeeGuestId}
              onEmployeeIdChange={(value) => {
                setEmployeeGuestId(value);
                if (employeeGuestError) setEmployeeGuestError('');
              }}
              onEmployeeSubmit={handleEmployeeGuestLogin}
              onLineLogin={handleLineLogin}
              loading={employeeGuestLoading || lineBindLoading}
              error={employeeGuestError || (authState === AUTH_STATES.AUTH_FAILED ? authError : '')}
              lineBindingRequired={isUnregistered}
            />
          )}

        {authState === AUTH_STATES.AUTH_REQUIRED && apiClient.transport !== 'worker' && !loading && (
          <div className="mb-4 text-center bg-white rounded-3xl p-6 shadow-sm border border-emerald-900/10 space-y-4">
            <div className="text-4xl">🔐</div>
            <h2 className="text-xl font-bold text-[#2C4A3E]">需要登入 LINE</h2>
            <p className="text-sm text-gray-500">請完成 LINE 登入後再使用便當預訂功能。</p>
            <button
              type="button"
              onClick={() => initLiffAndFetchData({ force: true })}
              className="w-full rounded-2xl bg-[#2C4A3E] py-3.5 text-sm font-bold text-white shadow-md transition hover:bg-emerald-800"
            >
              登入 LINE
            </button>
          </div>
        )}

        {authState === AUTH_STATES.AUTH_FAILED && apiClient.transport !== 'worker' && !loading && (
          <div className="mb-4 text-center text-sm font-bold p-3 rounded-xl bg-amber-50 text-amber-800 border border-amber-200">
            <div className="mb-2">身份驗證失敗</div>
            <div className="font-normal">{authError || `${authStage}: 無法取得有效 LINE 身份`}</div>
            <button
              type="button"
              onClick={() => initLiffAndFetchData({ force: true })}
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

        {isUnregistered && apiClient.transport !== 'worker' && !loading && (
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
            onImagePreview={handleImagePreview}
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

            {adminSection === 'announcements'
              && apiClient.transport === 'worker'
              && canAuth('manageAnnouncements')
              && !isViewAsMode && (
              <AnnouncementManagement
                announcements={adminAnnouncements}
                loading={adminAnnouncementsLoading}
                error={adminAnnouncementsError}
                isViewAsMode={isViewAsMode}
                onRefresh={() => loadAdminAnnouncements(true)}
                onCreate={createAdminAnnouncement}
                onUpdate={updateAdminAnnouncement}
                onDelete={deleteAdminAnnouncement}
              />
            )}
          </div>
        )}

      </main>

      <footer className="mx-auto mt-auto w-full max-w-xl px-4 py-5 text-center text-xs text-gray-400">
        <div>© 2026 Henry · 蔬食便當預訂系統
          <button
            type="button"
            onClick={() => setShowChangelogModal(true)}
            aria-label={`查看開發歷程，目前版本 ${APP_VERSION}`}
            className="rounded px-2 py-1 transition hover:text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            v{APP_VERSION}
          </button></div>
      </footer>

      {/* 底部導覽/操作列 */}
      {isRegistered && viewMode === 'order' && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4 shadow-lg z-40">
          <div className="max-w-xl mx-auto flex justify-between items-center">
            <div>
              <div className="text-xs text-gray-500">
                已選 <span className="font-bold bg-gray-100 px-1.5 py-0.5 rounded text-gray-800 border">{totalCount}</span> 份便購
              </div>
              <div className="text-xl font-bold text-[#2C4A3E]">${totalAmount}</div>
            </div>
            {!isExpired ? (
              <div className="flex gap-2">
                {hasExistingOrder && (
                  <button
                    onClick={handleCancelOrder}
                    disabled={loading || showCancelConfirmation || !activeOrderId || isViewAsMode}
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
                  送出訂單
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
                  min={apiClient.transport === 'worker' ? '1' : '0.01'}
                  step={apiClient.transport === 'worker' ? '1' : 'any'}
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

      <PickupFloorModal
        open={showFloorModal}
        floor={floorDraft}
        loading={floorLoading}
        error={floorError}
        onChange={setFloorDraft}
        onSave={handleSaveDefaultFloor}
        onClose={() => {
          if (!floorLoading) setShowFloorModal(false);
        }}
      />

      <ChangelogModal
        open={showChangelogModal}
        version={APP_VERSION}
        changelog={UI_CHANGELOG}
        onClose={() => setShowChangelogModal(false)}
      />

      <AnnouncementModal
        open={showAnnouncementModal}
        announcements={announcements}
        loading={!announcementsLoaded}
        onClose={() => setShowAnnouncementModal(false)}
      />

      <OrderConfirmationModal
        open={showOrderConfirmation}
        submission={orderSubmission}
        loading={loading}
        onCancel={() => setShowOrderConfirmation(false)}
        onConfirm={handleConfirmSubmit}
      />

      <OrderConfirmationModal
        open={showCancelConfirmation}
        submission={activeOrderSnapshot || orderSubmission}
        loading={loading}
        title="確認取消訂單"
        cancelLabel="返回"
        confirmLabel="確認取消"
        loadingLabel="取消中..."
        error={cancelError}
        onCancel={() => {
          if (!loading) {
            setShowCancelConfirmation(false);
            setCancelError('');
          }
        }}
        onConfirm={handleConfirmCancel}
      />

      <ImagePreviewModal
        imagePreview={imagePreview}
        onClose={() => setImagePreview(null)}
      />

    </div>
  );
}
