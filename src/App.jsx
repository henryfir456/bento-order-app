import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Swal from './lib/swal';
import { formatDateInput, formatTaipeiTopupNote, getTaipeiYearMonth, shiftYearMonth } from './dateUtils';
import { apiClient, guestSessionStore } from './api/apiClient';
import { formatApiErrorDiagnostic, getApiErrorPresentation } from './api/apiErrors';
import {
  clearClientRequestKey,
  createClientRequestKey,
  getStableClientRequestKey
} from './api/clientRequestKeys';
import { normalizeWorkerLikeResponse, restoreCalendarEvent } from './api/likeState';
import { authClient } from './auth/liffClient';
import { redactAuthSecrets, requireAuthoritativeIdentityState } from './auth/authRuntime';
import { createAuthErrorReporter } from './observability/authErrorReport';
import { createDeadline } from './auth/asyncDeadline.js';
import { canOfferLineBinding } from './auth/lineBindingState.js';
import { hasPermission } from './auth/permissions';
import {
  AUTH_BOOT_STAGES,
  IDENTITY_STATES,
  resolveWorkerAuthResolution,
  WORKER_AUTH_RESOLUTIONS
} from './auth/bootFlow';
import { createBootId, createBootTimingLogger, getPerformanceNow } from './observability/bootTiming';
import { APP_VERSION, UI_CHANGELOG } from './data/changelog';
import ChangelogModal from './components/ChangelogModal';
import LoadingNote from './components/ui/LoadingNote';
import BottomNavigation from './components/BottomNavigation';
import MyOrdersPage from './features/orders/MyOrdersPage';
import MyBentoFootprintsPage from './features/orders/MyBentoFootprintsPage';
import WalletPage from './features/balances/WalletPage';
import BalanceHistoryModal from './features/balances/BalanceHistoryModal';
import EmployeeGuestLogin from './components/EmployeeGuestLogin';
import LineEmployeeLookup from './components/LineEmployeeLookup';
import ProvisionalEmployeeOnboarding from './components/ProvisionalEmployeeOnboarding';
import PickupFloorModal from './components/PickupFloorModal';
import ViewAsBanner from './components/ViewAsBanner';
import DevAuthBadge from './components/DevAuthBadge';
import LocalUatBadge from './components/LocalUatBadge';
import LocalUatLogin from './components/LocalUatLogin';
import IdentityStatusBadges from './components/IdentityStatusBadges';
import { formatEmployeeId } from './components/userIdentityDisplay';
import ModernCalendar from './features/calendar/ModernCalendar';
import RollingCalendar from './features/calendar/RollingCalendar';
import { renderCalendarDays as renderCalendarDaysFor, renderWeekendEvents } from './features/calendar/calendarDays';
import AdminHub from './features/admin/AdminHub';
import OrderReminderSettings from './features/orders/OrderReminderSettings';
import {
  CANONICAL_VENDOR_FALLBACKS,
  normalizeVendor,
  normalizeVendorList,
  normalizeVendorName
} from './features/vendors/vendorModel';
import OrderPage from './features/orders/OrderPage';
import { buildDailyFlavorCardModel, isDailyFlavorMenuItem } from './features/orders/dailyFlavorPresentation.js';
import { getWorkerSelectionKey, normalizeWorkerOrderMenu } from './features/orders/orderSelection';
import { parseMenuItemName } from './features/orders/menuItemName';
import ImagePreviewModal from './features/orders/ImagePreviewModal';
import OrderConfirmationModal from './features/orders/OrderConfirmationModal';
import {
  buildExistingOrderSubmission,
  buildOrderSubmission
} from './features/orders/orderSubmission';
import { aggregateOrdersByFloor } from './features/admin/orderSummary.js';
import { filterMembersByEmployeeId } from './features/admin/delegateOrderFilter.js';
import { formatBalanceAmount } from './features/balances/formatters';
import { normalizeAnnouncementInbox, normalizeDeferredLikes, mergeDeferredLikes } from './features/bootstrap/deferredBootstrap';
import AnnouncementBell from './features/announcements/AnnouncementBell';
import AnnouncementInbox from './features/announcements/AnnouncementInbox';
import { getLineBindingState } from './auth/lineBindingState';
import AnnouncementPopup from './features/announcements/AnnouncementPopup';
import { TOPUP_METHOD_OPTIONS } from './features/balances/topupMethods';
import {
  getAdminMemberRows,
  isEligibleEmployeeBindingTarget
} from './features/balances/identityStatus';

// Admin and vendor screens load on demand so employees do not download them.
const AdminOrderSummary = React.lazy(() => import('./features/admin/AdminOrderSummary'));
const AnnouncementManagement = React.lazy(() => import('./features/admin/AnnouncementManagement'));
const MenuItemChangesManagement = React.lazy(() => import('./features/admin/MenuItemChangesManagement'));
const MemberBalanceManagement = React.lazy(() => import('./features/balances/MemberBalanceManagement'));
const AdminUserLedgerDetails = React.lazy(() => import('./features/balances/AdminUserLedgerDetails'));
const CalendarManagement = React.lazy(() => import('./features/calendar/CalendarManagement'));
const VendorHub = React.lazy(() => import('./features/vendors/VendorHub'));
const VendorOperationsPage = React.lazy(() => import('./features/vendors/VendorOperationsPage'));
const VendorCalendar = React.lazy(() => import('./features/vendors/VendorCalendar'));
const VendorFootprints = React.lazy(() => import('./features/vendors/VendorFootprints'));

// 自動根據目前環境讀取對應的變數
const AUTH_STATES = Object.freeze({
  AUTH_LOADING: 'AUTH_LOADING',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_FAILED: 'AUTH_FAILED',
  UNREGISTERED: 'UNREGISTERED',
  EMPLOYEE_BIND_REQUIRED: 'EMPLOYEE_BIND_REQUIRED',
  UNVERIFIED: 'UNVERIFIED',
  REGISTERED: 'REGISTERED'
});

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

// Failures that may clear on their own within a second or two.
const TRANSIENT_BOOTSTRAP_CODES = new Set([
  'API_AUTH_REJECTED',
  'API_REQUEST_FAILED',
  'LINE_PROFILE_UNAVAILABLE',
  'LINE_PROFILE_TIMEOUT'
]);

const fetchBootstrapData = async (accessToken, bootId, signal) => {
  try {
    if (!accessToken) {
      return { success: false, message: 'LIFF accessToken 不存在' };
    }

    const res = await apiClient.getBootstrap({ bootId, signal });
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

const getConfiguredVendor = (event) => {
  const vendor = normalizeVendorName(event?.vendor);
  return vendor || CANONICAL_VENDOR_FALLBACKS[0];
};

const normalize = (payload) => {
  if (!payload || payload.success !== true || !Array.isArray(payload.notifications)) return null;
  const notifications = payload.notifications
    .filter((item) => item && typeof item.id === 'string' && typeof item.title === 'string')
    .map((item) => ({
      id: item.id,
      kind: String(item.kind || ''),
      title: item.title,
      body: String(item.body || ''),
      refDate: item.refDate || null,
      createdAt: String(item.createdAt || ''),
      readAt: item.readAt || null
    }));
  return { notifications, unreadCount: notifications.filter((item) => !item.readAt).length };
};

// Bell notifications generated by the system (group cancellation refunds,
// vendor order close). Silent on failure: announcements keep their own error UI.
function useUserNotifications({ api, enabled, userKey }) {
  const [state, setState] = useState({ notifications: [], unreadCount: 0 });
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    if (!enabled) return;
    const requestId = ++requestRef.current;
    try {
      const response = await api.getMyNotifications();
      if (!response.ok) return;
      const next = normalize(await response.json());
      if (next && requestId === requestRef.current) setState(next);
    } catch { /* the bell still works without notifications */ }
  }, [api, enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setTimeout(() => { void reload(); }, 0);
    return () => {
      clearTimeout(timer);
      requestRef.current += 1;
    };
  }, [enabled, userKey, reload]);

  const markRead = useCallback(async (notification) => {
    if (!notification?.id || notification.readAt) return;
    try {
      const response = await api.markNotificationRead({ notificationId: notification.id });
      if (!response.ok) return;
      const payload = await response.json();
      const readAt = typeof payload?.readAt === 'string' ? payload.readAt : new Date().toISOString();
      setState((current) => {
        const notifications = current.notifications.map((item) => (
          item.id === notification.id ? { ...item, readAt } : item
        ));
        return { notifications, unreadCount: notifications.filter((item) => !item.readAt).length };
      });
    } catch { /* stays unread; retried on next open */ }
  }, [api]);

  return { ...state, reload, markRead };
}

export default function App() {
  const [viewMode, setViewMode] = useState('calendar');
  const [calendarUi, setCalendarUi] = useState(() => {
    try {
      // One-time reset so everyone starts on the rolling view; later choices are remembered.
      if (window.localStorage.getItem('bento-calendar-ui-default') !== 'rolling-v1') {
        window.localStorage.setItem('bento-calendar-ui-default', 'rolling-v1');
        window.localStorage.setItem('bento-calendar-ui', 'rolling');
        return 'rolling';
      }
      const saved = window.localStorage.getItem('bento-calendar-ui');
      return saved === 'classic' || saved === 'modern' ? saved : 'rolling';
    } catch { return 'rolling'; }
  });
  const [calendarEvents, setCalendarEvents] = useState({});
  const [vendors, setVendors] = useState([]);
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [vendorHubLoading, setVendorHubLoading] = useState(false);
  const [vendorDetailLoading, setVendorDetailLoading] = useState(false);
  const [vendorHubError, setVendorHubError] = useState('');
  const [vendorDetailError, setVendorDetailError] = useState('');
  const [vendorHubUnsupported, setVendorHubUnsupported] = useState(false);
  const vendorRequestRef = useRef(0);
  const negativeBalanceNoticeRef = useRef('');
  const [userOrdersMap, setUserOrdersMap] = useState({});
  const [myOrdersList, setMyOrdersList] = useState([]);
  const [myOrdersLoading, setMyOrdersLoading] = useState(false);
  const [myOrdersError, setMyOrdersError] = useState('');
  const myOrdersRequestRef = useRef(0);
  const [footprintsData, setFootprintsData] = useState(null);
  const [footprintsLoading, setFootprintsLoading] = useState(false);
  const [footprintsError, setFootprintsError] = useState('');
  const [footprintsPeriod, setFootprintsPeriod] = useState('all');
  const footprintsRequestRef = useRef(0);
  const [footprintsRefreshing, setFootprintsRefreshing] = useState(false);
  // Last successful statistics per subject and period, shown immediately while
  // a fresh read runs so switching periods or returning to the tab does not wait.
  const footprintsCacheRef = useRef(new Map());
  const [selectedCalendarKey, setSelectedCalendarKey] = useState('');
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const [lineUserId, setLineUserId] = useState('');
  const [authMode, setAuthMode] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [, setIdentityState] = useState(null);
  const [viewAsUser, setViewAsUser] = useState(null);
  const [delegatedOrderUser, setDelegatedOrderUser] = useState(null);
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
  const [employeeGuestSuccess, setEmployeeGuestSuccess] = useState('');
  const [lineBindLoading, setLineBindLoading] = useState(false);
  const [provisionalProfile, setProvisionalProfile] = useState({
    employeeId: '',
    displayName: '',
    pickupFloor: '1樓',
    lineDisplayName: ''
  });
  const authInitInFlightRef = useRef(false);
  const authBootPromiseRef = useRef(null);
  const authBootCompletedRef = useRef(false);
  const authAttemptRef = useRef(null);
  const authSelectionRef = useRef(0);
  const authSelectionBusyRef = useRef(false);
  const authResumeRef = useRef({ pending: false, lastAt: 0, timer: null, flush: null });
  const identityRefreshRef = useRef({ attempt: null, lastAt: 0 });
  const employeeGuestRequestRef = useRef(false);
  const bootRenderPendingRef = useRef(null);
  const deferredUiGenerationRef = useRef(0);
  const deferredUiBootRef = useRef('');

  const [selectedDate, setSelectedDate] = useState(null);
  const [activeOrderId, setActiveOrderId] = useState('');
  const [setting, setSetting] = useState(null);
  const [deadline, setDeadline] = useState(null);
  const [menu, setMenu] = useState([]);
  const [dailyFlavor, setDailyFlavor] = useState(null);
  const [imageLoadErrors, setImageLoadErrors] = useState({});
  const [name, setName] = useState('');
  const [floor, setFloor] = useState('1樓');
  const [orderNote, setOrderNote] = useState('');
  const [orderItems, setOrderItems] = useState({});
  const [activeOrderSnapshot, setActiveOrderSnapshot] = useState(null);
  const [hasExistingOrder, setHasExistingOrder] = useState(false);
  const [activeOrderReadOnly, setActiveOrderReadOnly] = useState(false);
  const [orderPolicy, setOrderPolicy] = useState(null);
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
  const [adminSection, setAdminSection] = useState('hub');
  const [adminAnnouncements, setAdminAnnouncements] = useState([]);
  const [adminAnnouncementsLoading, setAdminAnnouncementsLoading] = useState(false);
  const [adminAnnouncementsError, setAdminAnnouncementsError] = useState('');
  const [adminAnnouncementsLoaded, setAdminAnnouncementsLoaded] = useState(false);
  const adminAnnouncementsRequestRef = useRef(0);
  const [adminMenuChanges, setAdminMenuChanges] = useState([]);
  const [adminMenuVendors, setAdminMenuVendors] = useState([]);
  const [adminMenuChangesLoading, setAdminMenuChangesLoading] = useState(false);
  const [adminMenuChangesError, setAdminMenuChangesError] = useState('');
  const [adminMenuChangesLoaded, setAdminMenuChangesLoaded] = useState(false);
  const adminMenuChangesRequestRef = useRef(0);
  const [memberBalances, setMemberBalances] = useState([]);
  const [memberBalancesLoading, setMemberBalancesLoading] = useState(false);
  const [memberBalancesError, setMemberBalancesError] = useState('');
  const [memberBalancesLoaded, setMemberBalancesLoaded] = useState(false);
  const [includeInvalidMembers, setIncludeInvalidMembers] = useState(false);
  const memberBalancesRequestRef = useRef(0);
  const adminMemberRows = useMemo(() => getAdminMemberRows(memberBalances), [memberBalances]);
  const [orderTargetRows, setOrderTargetRows] = useState([]);
  const [orderTargetsLoading, setOrderTargetsLoading] = useState(false);
  const [orderTargetsError, setOrderTargetsError] = useState('');
  const [orderTargetsLoaded, setOrderTargetsLoaded] = useState(false);
  const orderTargetsRequestRef = useRef(0);
  const [showViewAsModal, setShowViewAsModal] = useState(false);
  const [viewAsModalMode, setViewAsModalMode] = useState(null);
  const [viewAsLedgerUser, setViewAsLedgerUser] = useState(null);
  const [employeeIdFilter, setEmployeeIdFilter] = useState('');
  const [showFloorModal, setShowFloorModal] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState('');
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
  const [announcementInboxLoading, setAnnouncementInboxLoading] = useState(false);
  const [announcementInboxError, setAnnouncementInboxError] = useState('');
  const [announcementUnreadCount, setAnnouncementUnreadCount] = useState(0);
  const [vendorNames, setVendorNames] = useState([]);
  const [announcementPopupQueue, setAnnouncementPopupQueue] = useState([]);
  const [announcementPopup, setAnnouncementPopup] = useState(null);
  const [announcementPopupDismissLoading, setAnnouncementPopupDismissLoading] = useState(false);
  const [announcementPopupDismissError, setAnnouncementPopupDismissError] = useState('');
  const announcementInboxRequestRef = useRef(0);
  const announcementPopupSessionRef = useRef({ key: '', shownIds: new Set() });
  const announcementReadMutationsRef = useRef(new Set());
  const [imagePreview, setImagePreview] = useState(null);
  const [calendarFlavorImageErrors, setCalendarFlavorImageErrors] = useState({});

  // 餘額歷史彈窗狀態
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyList, setHistoryList] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historySummaryExpanded, setHistorySummaryExpanded] = useState(false);
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
  const [topupMethod, setTopupMethod] = useState('TAIWAN_PAY');
  const [topupNote, setTopupNote] = useState(() => formatTaipeiTopupNote());
  const [topupLoading, setTopupLoading] = useState(false);
  const [topupIdempotencyKey, setTopupIdempotencyKey] = useState('');
  const [selectedEmployeeBindUser, setSelectedEmployeeBindUser] = useState(null);
  const [employeeBindId, setEmployeeBindId] = useState('');
  const [employeeBindLoading, setEmployeeBindLoading] = useState(false);
  const [employeeBindError, setEmployeeBindError] = useState('');

  // Admin 管理月曆彈窗狀態
  const [adminManageMode, setAdminManageMode] = useState(false);
  const [selectedAdminDate, setSelectedAdminDate] = useState(null);
  const [adminVendorChoice, setAdminVendorChoice] = useState('蔡老師');
  const [specialAdminDate, setSpecialAdminDate] = useState(formatDateInput(new Date()));
  const [specialAdminVendorChoice, setSpecialAdminVendorChoice] = useState('蔡老師');

  const isExpired = Boolean(deadline?.isExpired || deadline?.expired);
  const isOrderExpired = orderPolicy ? (!orderPolicy.canMutate && isExpired) : isExpired;
  const orderPolicyBlocked = Boolean(orderPolicy && !orderPolicy.canMutate);
  const orderMutationBlocked = orderPolicyBlocked || isOrderExpired;
  const normalOrderControlsOpen = !isExpired && !activeOrderReadOnly;
  const orderControlsOpen = orderPolicy
    ? orderPolicy.canMutate && !activeOrderReadOnly
    : normalOrderControlsOpen;

  const readCurrentCredential = useCallback(() => {
    if (apiClient.transport === 'worker'
      && (authMode === 'employee_guest' || authMode === 'vendor_code')) {
      return guestSessionStore.getGuestSession()?.token || '';
    }
    return authClient.getAccessToken();
  }, [authMode]);

  const clearIdentityData = () => {
    identityRefreshRef.current.attempt?.controller.abort(new Error('Identity changed'));
    identityRefreshRef.current.attempt = null;
    identityRefreshRef.current.lastAt = 0;
    adminSummaryRequestRef.current += 1;
    adminAnnouncementsRequestRef.current += 1;
    adminMenuChangesRequestRef.current += 1;
    historyRequestRef.current += 1;
    myOrdersRequestRef.current += 1;
    footprintsRequestRef.current += 1;
    footprintsCacheRef.current.clear();
    setFootprintsData(null);
    setFootprintsError('');
    setFootprintsLoading(false);
    setFootprintsRefreshing(false);
    setFootprintsPeriod('all');
    setMyOrdersList([]);
    setMyOrdersError('');
    setMyOrdersLoading(false);
    memberBalancesRequestRef.current += 1;
    setIncludeInvalidMembers(false);
    orderTargetsRequestRef.current += 1;
    vendorRequestRef.current += 1;
    deferredUiGenerationRef.current += 1;
    deferredUiBootRef.current = '';
    negativeBalanceNoticeRef.current = '';
    setLineUserId('');
    setAuthMode(null);
    setAuthUser(null);
    setIdentityState(null);
    setViewAsUser(null);
    setDelegatedOrderUser(null);
    setUserBalance(0);
    setDefaultFloor('');
    setRegistrationDisplayName('');
    setProvisionalProfile({
      employeeId: '',
      displayName: '',
      pickupFloor: '1樓',
      lineDisplayName: ''
    });
    setEmployeeGuestError('');
    setEmployeeGuestSuccess('');
    setName('');
    setCalendarEvents({});
    setVendors([]);
    setSelectedVendor(null);
    setVendorHubLoading(false);
    setVendorDetailLoading(false);
    setVendorHubError('');
    setVendorDetailError('');
    setVendorHubUnsupported(false);
    setUserOrdersMap({});
    setSelectedDate(null);
    setActiveOrderId('');
    setSetting(null);
    setDeadline(null);
    setMenu([]);
    setDailyFlavor(null);
    setImageLoadErrors({});
    setOrderItems({});
    setActiveOrderSnapshot(null);
    setHasExistingOrder(false);
    setActiveOrderReadOnly(false);
    setOrderPolicy(null);
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
    setAdminMenuChanges([]);
    setAdminMenuVendors([]);
    setAdminMenuChangesLoading(false);
    setAdminMenuChangesError('');
    setAdminMenuChangesLoaded(false);
    setMemberBalances([]);
    setMemberBalancesLoading(false);
    setMemberBalancesError('');
    setMemberBalancesLoaded(false);
    setOrderTargetRows([]);
    setOrderTargetsLoading(false);
    setOrderTargetsError('');
    setOrderTargetsLoaded(false);
    setShowViewAsModal(false);
    setViewAsModalMode(null);
    setEmployeeIdFilter('');
    setShowFloorModal(false);
    setProfileNameDraft('');
    setFloorDraft('');
    setFloorError('');
    setShowChangelogModal(false);
    announcementInboxRequestRef.current += 1;
    announcementPopupSessionRef.current = { key: '', shownIds: new Set() };
    announcementReadMutationsRef.current.clear();
    setAnnouncements([]);
    setLikesLoaded(false);
    setAnnouncementsLoaded(false);
    setShowAnnouncementModal(false);
    setAnnouncementInboxLoading(false);
    setAnnouncementInboxError('');
    setAnnouncementUnreadCount(0);
    setAnnouncementPopupQueue([]);
    setAnnouncementPopup(null);
    setAnnouncementPopupDismissLoading(false);
    setAnnouncementPopupDismissError('');
    setImagePreview(null);
    setAdminManageMode(false);
    setSelectedAdminDate(null);
    setSelectedTopupUser(null);
    setSelectedEmployeeBindUser(null);
    setEmployeeBindId('');
    setEmployeeBindLoading(false);
    setEmployeeBindError('');
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

  const authErrorReporterRef = useRef(null);
  if (!authErrorReporterRef.current) {
    authErrorReporterRef.current = createAuthErrorReporter({ apiClient, authClient, appVersion: APP_VERSION });
  }
  const reportAuthFailure = (stage, error) => authErrorReporterRef.current(stage, error);

  const failAuthentication = (stage, error) => {
    // A failed LIFF attempt must not be resurrected by queued foreground events.
    const resume = authResumeRef.current;
    resume.pending = false;
    clearTimeout(resume.timer);
    resume.timer = null;
    const safeMessage = redactAuthSecrets(error instanceof Error ? error.message : error);
    setAuthState(AUTH_STATES.AUTH_FAILED);
    setAuthStage(stage);
    setAuthError(`${stage}: ${safeMessage}`);
    clearIdentityData();
    console.error(`[AUTH] ${stage}: ${safeMessage}`);
    reportAuthFailure(stage, error);
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
      setIdentityState(requireAuthoritativeIdentityState(data));
      setAuthUser(nextUser);
      setViewAsUser(null);
      setLineUserId(data.lineUserId || nextUser.lineUserId || '');
      setUserBalance(nextUser.balance);
      setName(nextUser.name);
      setDefaultFloor(nextUser.defaultFloor);
      setFloor(nextUser.defaultFloor);
      if (nextUser.balance < 0 && negativeBalanceNoticeRef.current !== nextUser.userId) {
        negativeBalanceNoticeRef.current = nextUser.userId;
        void showPopup({
          icon: 'warning',
          title: '餘額為負值',
          text: `目前餘額為 ${formatBalanceAmount(nextUser.balance)}，請儘快儲值。`,
          confirmButtonText: '我知道了'
        });
      }
      return data;
    }

    if (data.success
      && data.registered === false
      && data.identityState === IDENTITY_STATES.EMPLOYEE_BIND_REQUIRED
      && data.user) {
      const nextUser = {
        ...data.user,
        userId: data.user.userId,
        name: data.user.name || data.user.displayName || '',
        floor: data.user.defaultFloor || data.user.floor || '',
        defaultFloor: data.user.defaultFloor || data.user.floor || '',
        balance: Number(data.user.balance || 0),
        role: data.user.role || 'User',
        authMode: data.authMode || 'line',
        capabilities: Array.isArray(data.capabilities) ? data.capabilities : []
      };
      const nextDisplayName = data.displayName
        || nextUser.name
        || '';
      setAuthMode(data.authMode || 'line');
      setIdentityState(requireAuthoritativeIdentityState(data));
      setAuthUser(nextUser);
      setViewAsUser(null);
      setLineUserId(data.lineUserId || nextUser.lineUserId || '');
      setRegistrationDisplayName(nextDisplayName);
      setRegistrationFloor(nextUser.defaultFloor || '1樓');
      setProvisionalProfile({
        employeeId: data.employeeId || nextUser.employeeId || '',
        displayName: nextDisplayName,
        pickupFloor: nextUser.defaultFloor || '1樓',
        lineDisplayName: data.displayName || nextDisplayName
      });
      setName(nextDisplayName);
      setDefaultFloor(nextUser.defaultFloor || '');
      setFloor(nextUser.defaultFloor || '1樓');
      setUserBalance(nextUser.balance);
      return data;
    }

    if (data.success
      && data.registered === false
      && data.authMode === 'employee_guest'
      && data.user) {
      const provisionalUser = data.user ? {
        ...data.user,
        userId: data.user.userId,
        name: data.user.name || data.user.displayName || '',
        floor: data.user.defaultFloor ?? data.user.floor ?? '',
        defaultFloor: data.user.defaultFloor ?? data.user.floor ?? '',
        balance: 0,
        role: data.user.role || 'User',
        authMode: data.authMode || 'line',
        capabilities: Array.isArray(data.capabilities) ? data.capabilities : []
      } : null;
      const nextEmployeeId = data.employeeId || provisionalUser?.employeeId || '';
      const nextDisplayName = data.displayName
        || provisionalUser?.name
        || '';
      const nextIdentityState = requireAuthoritativeIdentityState(data);
      setAuthMode(data.authMode || 'line');
      setIdentityState(nextIdentityState);
      setAuthUser(provisionalUser);
      setViewAsUser(null);
      setLineUserId(data.lineUserId || provisionalUser?.lineUserId || '');
      setRegistrationDisplayName(nextDisplayName);
      setRegistrationFloor(provisionalUser ? (provisionalUser.defaultFloor ?? '') : '1樓');
      setProvisionalProfile({
        employeeId: nextEmployeeId,
        displayName: nextDisplayName,
        pickupFloor: provisionalUser ? (provisionalUser.defaultFloor ?? '') : '1樓',
        lineDisplayName: data.displayName || provisionalUser?.name || ''
      });
      setName(nextDisplayName);
      setDefaultFloor(provisionalUser?.defaultFloor || '');
      setFloor(provisionalUser ? (provisionalUser.defaultFloor ?? '') : '1樓');
      setUserBalance(0);
      return data;
    }

    if (data.success && data.registered === false) {
      setAuthMode(data.authMode || 'line');
      setIdentityState(requireAuthoritativeIdentityState(data));
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
    const preferGuestSession = Boolean(options?.preferGuestSession);
    if (authBootPromiseRef.current && !force) {
      return authBootPromiseRef.current;
    }
    if (authBootCompletedRef.current && !force) {
      logAuthDiagnostic('AUTH_BOOT_SKIPPED_COMPLETED');
      return Promise.resolve();
    }

    authAttemptRef.current?.controller.abort(new Error('Auth attempt superseded'));
    const attempt = { controller: new AbortController() };
    authAttemptRef.current = attempt;
    const ownsAttempt = () => authAttemptRef.current === attempt;
    const deadline = createDeadline({
      timeoutMs: 30000,
      signal: attempt.controller.signal,
      error: Object.assign(new Error('登入連線逾時，請按重新連線。'), { code: 'AUTH_BOOT_TIMEOUT' })
    });
    const wait = (task) => deadline.wait(task);
    authInitInFlightRef.current = true;
    const run = (async () => {
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
      const hasStoredBindIntent = apiClient.transport === 'worker' && guestSessionStore.hasBindIntent();
      const hasBindIntent = Boolean(guestSession && hasStoredBindIntent);
      if (hasStoredBindIntent && !guestSession) guestSessionStore.clearBindIntent();
      const bindIntent = hasBindIntent ? guestSessionStore.getBindIntent() : {};
      if (authClient.isMock) {
        currentStage = 'MOCK_IDENTITY_READY';
        setAuthStage(currentStage);
        identity = authClient.getMockIdentity();
      } else {
      currentStage = AUTH_BOOT_STAGES.LIFF_CHECK;
      setAuthStage(currentStage);
      logAuthDiagnostic('LIFF_INIT_START');
      bootTiming.milestone('LIFF_INIT_START');
      const liffInitStartTime = getPerformanceNow();
      let liffAvailable = true;
      try {
        await wait(() => authClient.init());
      } catch (error) {
        if (!ownsAttempt() || deadline.signal.aborted) throw error;
        liffAvailable = false;
        if (apiClient.transport !== 'worker' || !guestSession || hasBindIntent) throw error;
        logAuthDiagnostic('LIFF_UNAVAILABLE_FALLBACK_TO_GUEST');
      } finally {
        bootTiming.milestone('LIFF_INIT_END');
        bootTiming.metric('LIFF_INIT_MS', getPerformanceNow() - liffInitStartTime);
      }
      if (!ownsAttempt()) return;

      let isLoggedIn = false;
      let accessToken = '';
      if (liffAvailable) {
        try {
          currentStage = 'LIFF_INIT_SUCCESS';
          setAuthStage(currentStage);
          logAuthDiagnostic(currentStage);
          isLoggedIn = authClient.isLoggedIn();
          logAuthDiagnostic(`LIFF_IS_LOGGED_IN=${isLoggedIn}`);
          logAuthDiagnostic(`LIFF_IS_IN_CLIENT=${authClient.isInClient()}`);
          if (isLoggedIn) {
            currentStage = 'LIFF_ACCESS_TOKEN_READ';
            setAuthStage(currentStage);
            accessToken = authClient.getAccessToken();
            logAuthDiagnostic(`LIFF_ACCESS_TOKEN_PRESENT=${Boolean(accessToken)}`);
          }
        } catch (error) {
          if (apiClient.transport !== 'worker' || !guestSession || hasBindIntent) throw error;
          liffAvailable = false;
          isLoggedIn = false;
          accessToken = '';
          logAuthDiagnostic('LINE_AUTH_CONTEXT_UNAVAILABLE_FALLBACK_TO_GUEST');
        }
      }

      const workerResolution = apiClient.transport === 'worker'
        ? resolveWorkerAuthResolution({
          hasGuestSession: Boolean(guestSession),
          hasBindIntent,
          preferGuestSession,
          lineAuthState: isLoggedIn && accessToken
            ? 'authenticated'
            : liffAvailable ? 'anonymous' : 'unavailable'
        })
        : null;

      if (workerResolution === WORKER_AUTH_RESOLUTIONS.EMPLOYEE_GUEST) {
        currentStage = AUTH_BOOT_STAGES.RESTORE_GUEST;
        setAuthStage(currentStage);
        logAuthDiagnostic('RESTORE_GUEST_SESSION');
        const restoredIdentity = await wait(() => fetchBootstrapData(guestSession.token, bootId, deadline.signal));
        if (!ownsAttempt()) return;
        if (restoredIdentity?.success && (
          (restoredIdentity.registered && restoredIdentity.user)
          || (restoredIdentity.authMode === 'employee_guest' && restoredIdentity.user)
          || restoredIdentity.status === 'UNVERIFIED_EMPLOYEE'
        )) {
          identity = restoredIdentity;
          restoredGuest = true;
          currentStage = AUTH_BOOT_STAGES.AUTH_GUEST;
          setAuthStage(currentStage);
        } else if (restoredIdentity?.code === 'GUEST_SESSION_INVALID') {
          guestSessionStore.clearGuestSession({ reason: 'restore-rejected', notify: false });
          guestSession = null;
        } else if (restoredIdentity?.code) {
          throw new Error(restoredIdentity.message || restoredIdentity.code);
        }
      }

      if (workerResolution === WORKER_AUTH_RESOLUTIONS.EMPLOYEE_GUEST && !restoredGuest) {
        setAuthState(AUTH_STATES.AUTH_REQUIRED);
        setAuthStage(AUTH_STATES.AUTH_REQUIRED);
        logAuthDiagnostic('AUTH_REQUIRED');
        return;
      }

      if (workerResolution === WORKER_AUTH_RESOLUTIONS.LOGIN_REQUIRED
        || (apiClient.transport !== 'worker' && !isLoggedIn)) {
        setAuthState(AUTH_STATES.AUTH_REQUIRED);
        setAuthStage(AUTH_STATES.AUTH_REQUIRED);
        logAuthDiagnostic('AUTH_REQUIRED');
        // Automatic recovery never redirects. Only explicit login/bind actions
        // may initiate OAuth; otherwise focus/pageshow can create login loops.
        if (apiClient.transport !== 'worker') authClient.login();
        return;
      }

      if (!restoredGuest && !accessToken) {
        failAuthentication('LIFF_ACCESS_TOKEN_MISSING', 'LIFF accessToken 不存在');
        return;
      }

      if (apiClient.transport === 'worker' && hasBindIntent && guestSession?.token) {
        currentStage = AUTH_BOOT_STAGES.RESTORE_GUEST;
        setAuthStage(currentStage);
        currentStage = AUTH_BOOT_STAGES.BIND_LINE;
        setAuthStage(currentStage);
        // Consume this explicit intent before POST. An ambiguous timeout must
        // not silently replay a binding mutation on resume or retry.
        guestSessionStore.clearBindIntent();
        const bindResponse = await wait(() => apiClient.bindLine({
          guestToken: guestSession.token,
          displayName: bindIntent.displayName,
          pickupFloor: bindIntent.pickupFloor
        }));
        if (!ownsAttempt()) return;
        if (!bindResponse.ok) throw new Error(`LINE bind HTTP ${bindResponse.status}`);
        const bindData = await wait(() => bindResponse.json());
        if (!ownsAttempt()) return;
        if (!bindData.success || !bindData.user) {
          throw new Error(bindData.error || bindData.message || 'LINE bind failed');
        }
        guestSessionStore.clearBindIntent();
        guestSessionStore.clearGuestSession({ reason: 'line-bound', notify: false });
        guestSession = null;
      }

      if (!restoredGuest) {
        currentStage = 'BACKEND_IDENTITY_VERIFY_START';
        setAuthStage(currentStage);
        const bootstrapRequestStartTime = getPerformanceNow();
        bootTiming.milestone('BOOTSTRAP_REQUEST_START');
        try {
          identity = await wait(() => fetchBootstrapData(accessToken, bootId, deadline.signal));
          if (!ownsAttempt()) return;
          if (!identity?.success && TRANSIENT_BOOTSTRAP_CODES.has(identity?.code)) {
            // A momentary LINE or network hiccup should not need a manual
            // reopen: retry once with a freshly read LIFF token.
            logAuthDiagnostic(`BOOTSTRAP_TRANSIENT_RETRY code=${identity.code}`);
            await wait(() => new Promise((resolve) => { setTimeout(resolve, 1000); }));
            if (!ownsAttempt()) return;
            const retryToken = authClient.getAccessToken() || accessToken;
            identity = await wait(() => fetchBootstrapData(retryToken, bootId, deadline.signal));
            if (!ownsAttempt()) return;
          }
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
      if (!ownsAttempt()) return;
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
        const nextAuthState = identity.identityState === IDENTITY_STATES.EMPLOYEE_BIND_REQUIRED
          ? AUTH_STATES.EMPLOYEE_BIND_REQUIRED
          : identity.authMode === 'employee_guest'
          && (
            identity.user
            || identity.status === 'UNVERIFIED_EMPLOYEE'
            || identity.identityState === IDENTITY_STATES.NEW_PROVISIONAL_EMPLOYEE
          )
          ? AUTH_STATES.UNVERIFIED
          : AUTH_STATES.UNREGISTERED;
        setAuthState(nextAuthState);
        setAuthStage(nextAuthState);
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
      if (!ownsAttempt()) return;
      failAuthentication(currentStage, err);
    } finally {
      deadline.dispose();
      if (ownsAttempt()) {
        setLoading(false);
        if (!awaitingRender) {
          if (typeof bootstrapNetworkMs === 'number') {
            bootTiming.metric('BOOTSTRAP_NETWORK_MS', bootstrapNetworkMs, bootStatus, isFallback);
          }
          bootTiming.metric('BOOT_TOTAL_MS', getPerformanceNow() - bootStartTime, bootStatus, isFallback);
        }
        authInitInFlightRef.current = false;
        authBootCompletedRef.current = true;
        if (authResumeRef.current.pending) {
          setTimeout(() => authResumeRef.current.flush?.(), 0);
        }
      }
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

  // Explicit entry changes revoke all earlier async ownership before awaiting
  // SDK/network work. Old boot completion must not overwrite the new choice.
  const beginAuthSelection = () => {
    const selection = ++authSelectionRef.current;
    authSelectionBusyRef.current = true;
    authResumeRef.current.pending = false;
    clearTimeout(authResumeRef.current.timer);
    authResumeRef.current.timer = null;
    employeeGuestRequestRef.current = false;
    setEmployeeGuestLoading(false);
    setLineBindLoading(false);
    authAttemptRef.current?.controller.abort(new Error('Auth entry changed'));
    authAttemptRef.current = null;
    authBootPromiseRef.current = null;
    authInitInFlightRef.current = false;
    authBootCompletedRef.current = false;
    bootRenderPendingRef.current = null;
    clearIdentityData();
    setLoading(false);
    setAuthState(AUTH_STATES.AUTH_REQUIRED);
    return selection;
  };

  useEffect(() => {
    const pendingBoot = bootRenderPendingRef.current;
    if (!pendingBoot || loading) return;
    if (
      authState !== AUTH_STATES.REGISTERED
      && authState !== AUTH_STATES.UNREGISTERED
      && authState !== AUTH_STATES.EMPLOYEE_BIND_REQUIRED
      && authState !== AUTH_STATES.UNVERIFIED
    ) return;

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
            logAuthDiagnostic('DEFERRED_UI_RESPONSE_MISMATCH');
            return;
          }
          if (!data?.success) {
            logAuthDiagnostic('DEFERRED_UI_REQUEST_FAILED');
            return;
          }

          const nextLikes = normalizeDeferredLikes(data.likes);
          if (nextLikes !== null) {
            setCalendarEvents(prev => mergeDeferredLikes(prev, nextLikes));
            setLikesLoaded(true);
          }
        })
        .catch(() => {
          if (deferredGeneration !== deferredUiGenerationRef.current) return;
          logAuthDiagnostic('DEFERRED_UI_REQUEST_FAILED');
        });
    }
  }, [authState, authUser, authMode, calendarEvents, userOrdersMap, loading, readCurrentCredential]);

  useEffect(() => {
    const unsubscribe = guestSessionStore.subscribe((event) => {
      if (event?.type !== 'guest-session-invalid' && event?.type !== 'guest-session-cleared') return;
      beginAuthSelection();
      authSelectionBusyRef.current = false;
      authBootCompletedRef.current = false;
      setAuthState(AUTH_STATES.AUTH_REQUIRED);
      setAuthStage(AUTH_BOOT_STAGES.RESTORE_GUEST);
      setAuthError('員工登入已失效，請重新輸入員工編號。');
      clearIdentityData();
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const resume = authResumeRef.current;
    const identityRefresh = identityRefreshRef.current;
    void initLiffAndFetchData();
    // initLiffAndFetchData is intentionally a render-local orchestration
    // closure; the boot must run only once on initial mount.
    return () => {
      clearTimeout(resume.timer);
      resume.timer = null;
      authSelectionRef.current += 1;
      identityRefresh.attempt?.controller.abort(new Error('App unmounted'));
      identityRefresh.attempt = null;
      authAttemptRef.current?.controller.abort(new Error('App unmounted'));
      authAttemptRef.current = null;
      authBootPromiseRef.current = null;
      authBootCompletedRef.current = false;
      authInitInFlightRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (apiClient.transport !== 'worker' || authClient.isMock) return undefined;
    // Registered users need a read-only projection refresh, not another LIFF
    // boot, redirect or binding POST. Keep actor and View As subject separate.
    const refreshRegisteredIdentity = () => {
      const refresh = identityRefreshRef.current;
      if (typeof apiClient.getIdentity !== 'function' || refresh.attempt) return;
      if (Date.now() - refresh.lastAt < 1000) return;
      const selection = authSelectionRef.current;
      const revokeRegisteredIdentity = () => {
        beginAuthSelection();
        authSelectionBusyRef.current = false;
        authBootCompletedRef.current = false;
        setAuthState(AUTH_STATES.AUTH_REQUIRED);
        setAuthStage(AUTH_BOOT_STAGES.RESTORE_GUEST);
        setAuthError('登入狀態已變更，請重新選擇登入方式。');
      };
      const currentCredential = () => {
        try { return readCurrentCredential(); } catch { return ''; }
      };
      const credential = currentCredential();
      if (selection !== authSelectionRef.current) return;
      if (!credential) { revokeRegisteredIdentity(); return; }
      const attempt = { controller: new AbortController() };
      refresh.attempt = attempt;
      refresh.lastAt = Date.now();
      const deadline = createDeadline({ timeoutMs: 15000, signal: attempt.controller.signal, error: new Error('IDENTITY_REFRESH_TIMEOUT') });
      const ownsAttempt = () => {
        if (refresh.attempt !== attempt || selection !== authSelectionRef.current) return false;
        const token = currentCredential();
        if (refresh.attempt !== attempt || selection !== authSelectionRef.current) return false;
        if (!token) { revokeRegisteredIdentity(); return false; }
        return credential === token;
      };
      void (async () => {
        try {
          const response = await deadline.wait(() => apiClient.getIdentity({ signal: deadline.signal }));
          const data = await deadline.wait(() => response.json());
          if (!ownsAttempt()) return;
          if (response.status === 401 || (data.success && (data.registered !== true
            || data.user?.userId !== authUser?.userId || data.authMode !== authMode))) {
            revokeRegisteredIdentity();
            return;
          }
          if (!response.ok || !data.success || !data.registered || !data.user
            || data.user.userId !== authUser?.userId || data.authMode !== authMode) {
            throw new Error('IDENTITY_REFRESH_INVALID');
          }
          const nextIdentityState = requireAuthoritativeIdentityState(data);
          if (data.user.role !== authUser?.role || nextIdentityState !== authUser?.identityState
            || data.user.active === false) {
            // A role/eligibility change invalidates protected subject caches.
            revokeRegisteredIdentity();
            return;
          }
          // Binding is display state only; the current session retains its
          // auth mode and server-projected capabilities/role.
          setAuthUser((current) => ({
            ...current,
            lineBound: data.user.lineBound,
            lineUserId: data.user.lineUserId,
            authSource: data.user.authSource,
            identityState: nextIdentityState,
            role: data.user.role || 'User',
            active: data.user.active,
            verificationStatus: data.user.verificationStatus,
            capabilities: Array.isArray(data.capabilities) ? data.capabilities : []
          }));
          setIdentityState(nextIdentityState);
        } catch (error) {
          if (ownsAttempt()) {
            if (error?.status === 401 || error?.code === 'API_AUTH_REQUIRED') {
              revokeRegisteredIdentity();
              return;
            }
            // A later foreground/online event can retry without closing LINE.
            refresh.lastAt = 0;
            logAuthDiagnostic('IDENTITY_REFRESH_FAILED');
          }
        } finally {
          deadline.dispose();
          if (refresh.attempt === attempt) refresh.attempt = null;
        }
      })();
    };
    const resumableStates = new Set([
      AUTH_STATES.AUTH_LOADING,
      AUTH_STATES.AUTH_REQUIRED
    ]);
    const resumeAfterLiffReturn = (event) => {
      const resume = authResumeRef.current;
      // Record foreground returns before checking busy/loading guards. Android
      // LINE WebView may emit its only return event while an explicit login
      // selection is still waiting for LIFF to settle.
      if (event && document.visibilityState !== 'hidden') resume.pending = true;
      if (document.visibilityState === 'hidden') return;
      if (authSelectionBusyRef.current || lineBindLoading) return;
      if (authState === AUTH_STATES.REGISTERED) {
        resume.pending = false;
        if (event) refreshRegisteredIdentity();
        return;
      }
      if (!resumableStates.has(authState)) {
        resume.pending = false;
        clearTimeout(resume.timer);
        resume.timer = null;
        return;
      }
      if (!resume.pending || loading || authInitInFlightRef.current) return;
      // Do not auto-restart a settled boot. New authentication is user initiated.
      if (authBootCompletedRef.current && authState !== AUTH_STATES.AUTH_REQUIRED) {
        resume.pending = false;
        return;
      }
      const now = Date.now();
      if (now - resume.lastAt < 1000) {
        if (resume.timer === null) {
          resume.timer = setTimeout(() => {
            resume.timer = null;
            resume.flush?.();
          }, 1000 - (now - resume.lastAt));
        }
        return;
      }
      clearTimeout(resume.timer);
      resume.timer = null;
      resume.lastAt = now;
      resume.pending = false;
      authBootCompletedRef.current = false;
      logAuthDiagnostic('LIFF_RETURN_RESUME');
      void initLiffAndFetchData({ force: true });
    };
    authResumeRef.current.flush = resumeAfterLiffReturn;

    window.addEventListener('pageshow', resumeAfterLiffReturn);
    window.addEventListener('focus', resumeAfterLiffReturn);
    window.addEventListener('online', resumeAfterLiffReturn);
    document.addEventListener('visibilitychange', resumeAfterLiffReturn);
    // Drain one coalesced return event after the current boot settles.
    resumeAfterLiffReturn();
    return () => {
      window.removeEventListener('pageshow', resumeAfterLiffReturn);
      window.removeEventListener('focus', resumeAfterLiffReturn);
      window.removeEventListener('online', resumeAfterLiffReturn);
      document.removeEventListener('visibilitychange', resumeAfterLiffReturn);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, loading, lineBindLoading, authUser, authMode, readCurrentCredential]);

  const canManageAdminAnnouncements = () => (
    apiClient.transport === 'worker'
    && authState === AUTH_STATES.REGISTERED
    && Boolean(authUser?.userId)
    && !viewAsUser
    && hasPermission(authUser?.role, 'manageAnnouncements', authMode, true)
  );

  const isVendorSession = authUser?.role === 'Vendor';
  const userNotifications = useUserNotifications({
    api: apiClient,
    enabled: (apiClient.transport === 'worker' || authClient.isMock)
      && authState === AUTH_STATES.REGISTERED
      && Boolean(authUser?.userId)
      && !viewAsUser?.userId,
    userKey: `${authUser?.userId || ''}:${authMode || ''}`
  });

  const loadAnnouncementInbox = useCallback(async ({ queuePopups = true } = {}) => {
    if (authState !== AUTH_STATES.REGISTERED || !authUser?.userId || viewAsUser?.userId || authUser?.role === 'Vendor') return false;
    const requestId = ++announcementInboxRequestRef.current;
    const sessionKey = `${authUser.userId}:${authMode || ''}:${authSelectionRef.current}`;
    if (announcementPopupSessionRef.current.key !== sessionKey) {
      announcementPopupSessionRef.current = { key: sessionKey, shownIds: new Set() };
      setAnnouncementPopupQueue([]);
      setAnnouncementPopup(null);
      setAnnouncementPopupDismissError('');
    }
    setAnnouncementInboxLoading(true);
    setAnnouncementInboxError('');
    try {
      const response = await apiClient.getMyAnnouncements();
      if (!response.ok) throw Object.assign(new Error('ANNOUNCEMENT_INBOX_HTTP_ERROR'), {
        code: 'ANNOUNCEMENT_INBOX_HTTP_ERROR',
        requestId: response.headers.get('X-Request-Id')
      });
      const payload = await response.json();
      const normalized = normalizeAnnouncementInbox(payload);
      if (!normalized) throw Object.assign(new Error('ANNOUNCEMENT_INBOX_RESPONSE_INVALID'), {
        code: 'ANNOUNCEMENT_INBOX_RESPONSE_INVALID',
        requestId: response.headers.get('X-Request-Id')
      });
      if (requestId !== announcementInboxRequestRef.current
        || viewAsUser?.userId
        || sessionKey !== `${authUser?.userId || ''}:${authMode || ''}:${authSelectionRef.current}`) return false;

      setAnnouncements(normalized.announcements);
      setAnnouncementUnreadCount(normalized.unreadCount);
      setAnnouncementsLoaded(true);
      if (queuePopups && announcementPopupSessionRef.current.key === sessionKey) {
        const session = announcementPopupSessionRef.current;
        const candidates = normalized.announcements.filter((announcement) => (
          announcement.shouldAutoPopup && !session.shownIds.has(announcement.id)
        ));
        candidates.forEach((announcement) => session.shownIds.add(announcement.id));
        if (candidates.length) {
          setAnnouncementPopupQueue((current) => {
            const queuedIds = new Set(current.map((announcement) => announcement.id));
            return [...current, ...candidates.filter((announcement) => !queuedIds.has(announcement.id))];
          });
        }
      }
      return true;
    } catch (error) {
      if (requestId === announcementInboxRequestRef.current && !viewAsUser?.userId) {
        setAnnouncementsLoaded(true);
        setAnnouncementInboxError(`公告暫時無法載入，請重新載入。${formatApiErrorDiagnostic(error)}`);
      }
      return false;
    } finally {
      if (requestId === announcementInboxRequestRef.current) setAnnouncementInboxLoading(false);
    }
  }, [authState, authUser?.userId, authUser?.role, authMode, viewAsUser?.userId]);

  const markAnnouncementRead = useCallback(async (announcement) => {
    const id = String(announcement?.id || '').trim();
    if (!id || announcement?.readAt || viewAsUser?.userId || announcementReadMutationsRef.current.has(id)) return;
    announcementReadMutationsRef.current.add(id);
    try {
      const response = await apiClient.markAnnouncementRead({ announcementId: id });
      if (!response.ok) throw Object.assign(new Error('ANNOUNCEMENT_READ_HTTP_ERROR'), {
        code: 'ANNOUNCEMENT_READ_HTTP_ERROR',
        requestId: response.headers.get('X-Request-Id')
      });
      const payload = await response.json();
      if (payload?.success !== true) throw Object.assign(new Error('ANNOUNCEMENT_READ_RESPONSE_INVALID'), {
        code: 'ANNOUNCEMENT_READ_RESPONSE_INVALID',
        requestId: response.headers.get('X-Request-Id')
      });
      const readAt = typeof payload.readAt === 'string' ? payload.readAt : new Date().toISOString();
      setAnnouncements((current) => current.map((item) => item.id === id ? { ...item, readAt } : item));
      setAnnouncementUnreadCount((current) => Math.max(0, current - 1));
    } catch (error) {
      setAnnouncementInboxError(`公告已開啟，但未能儲存已讀狀態；可重新載入後再試。${formatApiErrorDiagnostic(error)}`);
    } finally {
      announcementReadMutationsRef.current.delete(id);
    }
  }, [viewAsUser?.userId]);

  const closeAnnouncementPopup = () => {
    setAnnouncementPopup(null);
    setAnnouncementPopupDismissError('');
  };

  const dismissAnnouncementPopup = async () => {
    const id = String(announcementPopup?.id || '').trim();
    if (!id || announcementPopupDismissLoading || viewAsUser?.userId) return;
    setAnnouncementPopupDismissLoading(true);
    setAnnouncementPopupDismissError('');
    try {
      const response = await apiClient.dismissAnnouncementAutoPopup({ announcementId: id });
      if (!response.ok) throw Object.assign(new Error('ANNOUNCEMENT_DISMISS_HTTP_ERROR'), {
        code: 'ANNOUNCEMENT_DISMISS_HTTP_ERROR',
        requestId: response.headers.get('X-Request-Id')
      });
      const payload = await response.json();
      if (payload?.success !== true) throw Object.assign(new Error('ANNOUNCEMENT_DISMISS_RESPONSE_INVALID'), {
        code: 'ANNOUNCEMENT_DISMISS_RESPONSE_INVALID',
        requestId: response.headers.get('X-Request-Id')
      });
      const dismissAutoPopupAt = typeof payload.dismissAutoPopupAt === 'string'
        ? payload.dismissAutoPopupAt
        : new Date().toISOString();
      setAnnouncements((current) => current.map((item) => item.id === id
        ? { ...item, dismissAutoPopupAt, shouldAutoPopup: false }
        : item));
      setAnnouncementPopup(null);
    } catch (error) {
      setAnnouncementPopupDismissError(`目前無法儲存此設定，請重試。${formatApiErrorDiagnostic(error)}`);
    } finally {
      setAnnouncementPopupDismissLoading(false);
    }
  };

  useEffect(() => {
    if (authState !== AUTH_STATES.REGISTERED || loading || viewAsUser?.userId) return undefined;
    void loadAnnouncementInbox();
    return () => {
      announcementInboxRequestRef.current += 1;
    };
  }, [authState, authUser?.userId, authMode, loading, viewAsUser?.userId, loadAnnouncementInbox]);

  useEffect(() => {
    if (showAnnouncementModal || announcementPopup || announcementPopupQueue.length === 0) return;
    const [next, ...remaining] = announcementPopupQueue;
    setAnnouncementPopupQueue(remaining);
    setAnnouncementPopup(next);
    setAnnouncementPopupDismissError('');
    void markAnnouncementRead(next);
  }, [showAnnouncementModal, announcementPopup, announcementPopupQueue, markAnnouncementRead]);

  const refreshPublicAnnouncements = async () => {
    if (authState !== AUTH_STATES.REGISTERED || viewAsUser?.userId) return;
    await loadAnnouncementInbox({ queuePopups: false });
  };

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
      throw new Error('公告管理僅限已註冊的 Admin 使用。');
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

  const canManageAdminMenuChanges = () => (
    apiClient.transport === 'worker'
    && authState === AUTH_STATES.REGISTERED
    && Boolean(authUser?.userId)
    && !viewAsUser
    && hasPermission(authUser?.role, 'manageMenu', authMode, true)
  );

  const getAdminDailyFlavorSyncStatus = useCallback(async () => {
    if (
      apiClient.transport !== 'worker'
      || authState !== AUTH_STATES.REGISTERED
      || !authUser?.userId
      || viewAsUser
      || !hasPermission(authUser?.role, 'manageMenu', authMode, true)
    ) return null;
    const response = await apiClient.getAdminDailyFlavorSyncStatus();
    return response.json();
  }, [authMode, authState, authUser, viewAsUser]);

  const syncAdminDailyFlavors = useCallback(async () => {
    if (
      apiClient.transport !== 'worker'
      || authState !== AUTH_STATES.REGISTERED
      || !authUser?.userId
      || viewAsUser
      || !hasPermission(authUser?.role, 'manageMenu', authMode, true)
    ) throw new Error('蔡老師每日風味餐同步僅限已註冊的 Admin 使用。');
    const response = await apiClient.syncAdminDailyFlavors();
    return response.json();
  }, [authMode, authState, authUser, viewAsUser]);

  const loadAdminMenuChanges = async (force = false) => {
    if (!canManageAdminMenuChanges()) return;
    if (!force && adminMenuChangesLoaded) return;

    const requestId = ++adminMenuChangesRequestRef.current;
    setAdminMenuChangesLoading(true);
    setAdminMenuChangesError('');

    try {
      const accessToken = readCurrentCredential();
      if (!accessToken) {
        setAdminMenuChangesError('目前無法驗證身份，請重新登入後再試。');
        return;
      }
      const [changesResponse, vendorsResponse] = await Promise.all([
        apiClient.getAdminMenuChanges(),
        apiClient.getAdminMenuVendors()
      ]);
      const [data, vendorsData] = await Promise.all([
        changesResponse.json(),
        vendorsResponse.json()
      ]);
      if (requestId !== adminMenuChangesRequestRef.current) return;

      if (!Array.isArray(data.changes) || !Array.isArray(vendorsData.vendors)) {
        setAdminMenuChangesError('目前無法取得菜單維護資料，請稍後再試。');
        return;
      }
      setAdminMenuChanges(data.changes);
      setAdminMenuVendors(vendorsData.vendors);
      setAdminMenuChangesLoaded(true);
    } catch (error) {
      if (requestId === adminMenuChangesRequestRef.current) {
        setAdminMenuChangesError(error?.code
          ? `目前無法取得菜單維護資料（${error.code}），請稍後再試。`
          : '目前無法取得菜單維護資料，請稍後再試。');
      }
    } finally {
      if (requestId === adminMenuChangesRequestRef.current) setAdminMenuChangesLoading(false);
    }
  };

  const assertAdminMenuChangesMutationAllowed = () => {
    if (!canManageAdminMenuChanges()) {
      throw new Error('菜單品項維護僅限已註冊的 Admin 使用。');
    }
  };

  const createAdminMenuChange = async (payload) => {
    assertAdminMenuChangesMutationAllowed();
    await apiClient.createAdminMenuChange(payload);
  };

  const previewAdminMenu = async ({ vendor, targetDate }) => {
    assertAdminMenuChangesMutationAllowed();
    const res = await apiClient.getAdminMenuPreview({ vendor, targetDate });
    const data = await res.json();
    return data;
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

  const loadMemberBalances = async (force = false, includeInvalid = includeInvalidMembers) => {
    const visibleRole = viewAsUser?.role || authUser?.role;
    if (!authUser?.userId || !hasPermission(visibleRole, 'viewMemberBalances', authMode, true)) return;
    if (!force && memberBalancesLoaded) return;
    const canIncludeInvalid = includeInvalid
      && authMode === 'line'
      && authUser?.role === 'Admin'
      && !viewAsUser
      && (apiClient.transport === 'worker' || (apiClient.transport === 'mock' && import.meta.env.DEV));

    const requestId = ++memberBalancesRequestRef.current;
    setMemberBalancesLoading(true);
    setMemberBalancesError('');

    try {
      const accessToken = readCurrentCredential();
      if (!accessToken) {
        setMemberBalancesError('目前無法驗證身份，請重新登入後再試。');
        return;
      }
      const res = await apiClient.getMemberBalances({ includeInvalid: canIncludeInvalid });
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

  const loadOrderTargets = async (force = false) => {
    if (apiClient.transport !== 'worker' || !authUser?.userId || !canAuth('delegateOrder')) return;
    if (!force && orderTargetsLoaded) return;

    const requestId = ++orderTargetsRequestRef.current;
    setOrderTargetsLoading(true);
    setOrderTargetsError('');

    try {
      const accessToken = readCurrentCredential();
      if (!accessToken) {
        setOrderTargetsError('目前無法驗證身份，請重新登入後再試。');
        return;
      }
      const res = await apiClient.getOrderTargets();
      const data = await res.json();
      if (requestId !== orderTargetsRequestRef.current) return;

      if (data.success && Array.isArray(data.targets)) {
        setOrderTargetRows(data.targets);
        setOrderTargetsLoaded(true);
      } else {
        setOrderTargetsError('目前無法取得可代點餐成員，請稍後再試。');
      }
    } catch {
      if (requestId === orderTargetsRequestRef.current) {
        setOrderTargetsError('目前無法取得可代點餐成員，請稍後再試。');
      }
    } finally {
      if (requestId === orderTargetsRequestRef.current) setOrderTargetsLoading(false);
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
      || lineBindLoading
      || employeeGuestRequestRef.current
    ) return;

    const employeeId = String(employeeGuestId || '').trim();
    if (!employeeId) {
      setEmployeeGuestError('請輸入員工編號。');
      return;
    }

    const selection = beginAuthSelection();
    guestSessionStore.clearBindIntent();
    employeeGuestRequestRef.current = true;
    setEmployeeGuestLoading(true);
    setEmployeeGuestError('');
    setEmployeeGuestSuccess('');
    setAuthError('');
    try {
      const response = await apiClient.employeeGuestLogin({ employeeId });
      const data = await response.json();
      if (selection !== authSelectionRef.current) return;
      // vendor_code: temporary Vendor sign-in by vendor code (Worker switch).
      if (!data.success || !['employee_guest', 'vendor_code'].includes(data.authMode)
        || !data.token || !data.expiresAt) {
        throw new Error(data.error || data.message || 'EMPLOYEE_GUEST_LOGIN_INVALID_RESPONSE');
      }
      guestSessionStore.setGuestSession({ token: data.token, expiresAt: data.expiresAt });
      authBootCompletedRef.current = false;
      if (data.status === 'UNVERIFIED_EMPLOYEE') {
        setProvisionalProfile((current) => ({
          ...current,
          employeeId: data.employeeId || employeeId.toUpperCase(),
          displayName: '',
          pickupFloor: '1樓',
          lineDisplayName: ''
        }));
        setEmployeeGuestId(data.employeeId || employeeId.toUpperCase());
      } else {
        setEmployeeGuestId('');
      }
      authSelectionBusyRef.current = false;
      await initLiffAndFetchData({ force: true, preferGuestSession: true });
    } catch (error) {
      if (selection !== authSelectionRef.current) return;
      setEmployeeGuestError(getApiErrorPresentation(error, '員工登入').message);
    } finally {
      if (selection === authSelectionRef.current) {
      authSelectionBusyRef.current = false;
      employeeGuestRequestRef.current = false;
      setEmployeeGuestLoading(false);
      }
    }
  };

  const handleEmployeeGuestOnboarding = async ({ displayName, pickupFloor } = {}) => {
    if (
      apiClient.transport !== 'worker'
      || lineBindLoading
      || authMode !== 'employee_guest'
    ) return;
    const guestSession = guestSessionStore.getGuestSession();
    if (!guestSession) {
      setEmployeeGuestError('員工登入已失效，請重新輸入員工編號。');
      setAuthState(AUTH_STATES.AUTH_REQUIRED);
      setAuthStage(AUTH_STATES.AUTH_REQUIRED);
      return;
    }

    const selection = authSelectionRef.current;
    setLineBindLoading(true);
    setEmployeeGuestError('');
    setEmployeeGuestSuccess('');
    setAuthError('');
    try {
      const response = authUser?.userId && authUser.profileComplete === false
        ? await apiClient.updatePickupFloor({ displayName, pickupFloor })
        : await apiClient.completeEmployeeGuestOnboarding({
          guestToken: guestSession.token,
          displayName,
          pickupFloor
        });
      if (selection !== authSelectionRef.current) return;
      const data = await response.json();
      if (selection !== authSelectionRef.current) return;
      if (
        !response.ok
        || !data.success
        || data.authMode !== 'employee_guest'
        || !['UNVERIFIED_EMPLOYEE', 'VERIFIED'].includes(data.status)
        || !data.user
      ) {
        throw new Error(data.error || data.message || 'EMPLOYEE_GUEST_ONBOARDING_INVALID_RESPONSE');
      }
      // Re-resolve the canonical identity and bootstrap in the same session.
      // The onboarding response is not treated as the final UI projection.
      authBootCompletedRef.current = false;
      await initLiffAndFetchData({ force: true, preferGuestSession: true });
    } catch (error) {
      if (selection !== authSelectionRef.current) return;
      setEmployeeGuestError(getApiErrorPresentation(error, '完成 onboarding').message);
    } finally {
      if (selection === authSelectionRef.current) setLineBindLoading(false);
    }
  };

  const handleLineEmployeeBindRequired = async (event) => {
    event?.preventDefault?.();
    if (apiClient.transport !== 'worker' || lineBindLoading) return;

    const employeeId = String(employeeGuestId || '').trim();
    if (!employeeId) {
      setEmployeeGuestError('請輸入員工編號。');
      return;
    }

    await handleLineEmployeeBind({
      employeeId,
      displayName: registrationDisplayName || undefined,
      pickupFloor: registrationFloor || '1樓'
    });
  };

  const handleLineLogin = async () => {
    if (lineBindLoading) return;
    const selection = beginAuthSelection();
    setEmployeeGuestLoading(false);
    employeeGuestRequestRef.current = false;
    try {
      // An explicit LINE entry selects LINE for this session. This only
      // clears the local employee credential; it never changes LINE ownership.
      guestSessionStore.clearGuestSession({ reason: 'line-login', notify: false });
      guestSessionStore.clearBindIntent();
      await authClient.init();
      if (selection !== authSelectionRef.current) return;
      if (!authClient.isLoggedIn()) {
        authClient.login();
        // If the WebView never navigates (Android LINE), tell the user how to proceed.
        setTimeout(() => {
          if (selection === authSelectionRef.current && document.visibilityState !== 'hidden') {
            setEmployeeGuestError('LINE 登入沒有跳轉時，請再按一次「使用 LINE 登入」，或從 LINE 聊天室重新開啟連結。');
          }
        }, 6000);
        return;
      }
      authBootCompletedRef.current = false;
      authSelectionBusyRef.current = false;
      await initLiffAndFetchData({ force: true });
    } catch (error) {
      if (selection !== authSelectionRef.current) return;
      failAuthentication('LIFF_LOGIN_REQUEST_FAILED', error);
    } finally {
      if (selection === authSelectionRef.current) {
        authSelectionBusyRef.current = false;
        // A return event may have arrived while the explicit login owned the UI.
        // Recheck after React applies the completed boot, without another redirect.
        if (authResumeRef.current.pending) setTimeout(() => authResumeRef.current.flush?.(), 0);
      }
    }
  };

  const handleBindLine = async (profile = {}) => {
    if (apiClient.transport !== 'worker' || lineBindLoading) return;
    if (authState === AUTH_STATES.REGISTERED && !canOfferLineBinding({
      user: authUser, registered: true, transport: apiClient.transport, authMode, isViewAsMode: Boolean(viewAsUser)
    })) return;
    const guestSession = guestSessionStore.getGuestSession();
    if (!guestSession) {
      setEmployeeGuestError('員工登入已失效，請重新輸入員工編號。');
      setAuthState(AUTH_STATES.AUTH_REQUIRED);
      return;
    }

    const selection = beginAuthSelection();
    guestSessionStore.setBindIntent(profile);
    authBootCompletedRef.current = false;
    setLineBindLoading(true);
    setEmployeeGuestError('');
    setAuthError('');
    try {
      await authClient.init();
      if (selection !== authSelectionRef.current) return;
      if (!authClient.isLoggedIn()) {
        setAuthState(AUTH_STATES.AUTH_REQUIRED);
        setAuthStage(AUTH_BOOT_STAGES.LIFF_CHECK);
        authClient.login();
        return;
      }

      guestSessionStore.clearBindIntent();
      const response = await apiClient.bindLine({
        guestToken: guestSession.token,
        displayName: profile.displayName,
        pickupFloor: profile.pickupFloor
      });
      const data = await response.json();
      if (selection !== authSelectionRef.current) return;
      if (!data.success || !data.user) {
        throw new Error(data.error || data.message || 'LINE_BIND_FAILED');
      }
      guestSessionStore.clearBindIntent();
      guestSessionStore.clearGuestSession({ reason: 'line-bound', notify: false });
      authBootCompletedRef.current = false;
      authSelectionBusyRef.current = false;
      await initLiffAndFetchData({ force: true });
    } catch (error) {
      if (selection !== authSelectionRef.current) return;
      guestSessionStore.clearBindIntent();
      setEmployeeGuestError(getApiErrorPresentation(error, '綁定 LINE').message);
    } finally {
      if (selection === authSelectionRef.current) {
      authSelectionBusyRef.current = false;
      setLineBindLoading(false);
      }
    }
  };

  const handleLineEmployeeBind = async ({ employeeId, displayName, pickupFloor } = {}) => {
    if (apiClient.transport !== 'worker' || lineBindLoading) return;
    const normalizedEmployeeId = String(employeeId || '').trim();
    if (!normalizedEmployeeId) {
      setEmployeeGuestError('員工身份查詢已失效，請重新輸入員工編號。');
      setAuthState(AUTH_STATES.UNREGISTERED);
      setAuthStage(AUTH_STATES.UNREGISTERED);
      return;
    }

    const selection = authSelectionRef.current;
    setLineBindLoading(true);
    setEmployeeGuestError('');
    setAuthError('');
    try {
      await authClient.init();
      if (selection !== authSelectionRef.current) return;
      if (!authClient.isLoggedIn()) {
        setAuthState(AUTH_STATES.AUTH_REQUIRED);
        setAuthStage(AUTH_BOOT_STAGES.LIFF_CHECK);
        authClient.login();
        return;
      }

      const response = await apiClient.lineEmployeeBind({
        employeeId: normalizedEmployeeId,
        displayName,
        pickupFloor
      });
      if (selection !== authSelectionRef.current) return;
      const data = await response.json();
      if (selection !== authSelectionRef.current) return;
      if (!data.success || !data.user) {
        throw new Error(data.error || data.message || 'LINE_EMPLOYEE_BIND_FAILED');
      }
      authBootCompletedRef.current = false;
      if (data.authMode === 'employee_guest' && data.token && data.expiresAt) {
        guestSessionStore.setGuestSession({ token: data.token, expiresAt: data.expiresAt });
        await initLiffAndFetchData({ force: true, preferGuestSession: true });
      } else if (data.authMode === 'line') {
        guestSessionStore.clearBindIntent();
        guestSessionStore.clearGuestSession({ reason: 'line-bound', notify: false });
        await initLiffAndFetchData({ force: true });
      } else {
        throw new Error('LINE_EMPLOYEE_BIND_IDENTITY_INVALID');
      }
    } catch (error) {
      if (selection !== authSelectionRef.current) return;
      setEmployeeGuestError(getApiErrorPresentation(error, '綁定 LINE').message);
    } finally {
      if (selection === authSelectionRef.current) setLineBindLoading(false);
    }
  };

  const handleProvisionalProfileSubmit = async (event) => {
    event?.preventDefault?.();
    if (lineBindLoading || authMode !== 'employee_guest') return;
    const profile = {
      displayName: provisionalProfile.displayName.trim(),
      pickupFloor: provisionalProfile.pickupFloor
    };
    if (!profile.displayName || !profile.pickupFloor) {
      setEmployeeGuestError('請填寫顯示名稱與領取樓層。');
      return;
    }

    setEmployeeGuestSuccess('');
    await handleEmployeeGuestOnboarding(profile);
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

  const vendorResponseError = (data, fallback) => {
    const error = new Error(data?.error || data?.message || fallback);
    error.code = data?.error || data?.code || 'VENDOR_API_ERROR';
    return error;
  };

  const openVendorHub = async () => {
    if (authState !== AUTH_STATES.REGISTERED || !authUserId) return;

    setViewMode('vendors');
    setSelectedVendor(null);
    setVendorDetailError('');
    setVendorHubError('');
    setVendorHubUnsupported(false);

    if (apiClient.transport === 'gas') {
      setVendorHubUnsupported(true);
      return;
    }

    const requestId = ++vendorRequestRef.current;
    setVendorHubLoading(true);
    try {
      const response = await apiClient.getVendors({
        viewAsUserId: apiClient.transport === 'worker' ? viewAsUser?.userId : null
      });
      const data = await response.json();
      if (!response.ok || data?.success === false) {
        throw vendorResponseError(data, '店家列表讀取失敗');
      }
      if (requestId !== vendorRequestRef.current) return;
      setVendors(normalizeVendorList(data));
    } catch (error) {
      if (requestId !== vendorRequestRef.current) return;
      setVendorHubError(getApiErrorPresentation(error, '讀取店家列表').message);
    } finally {
      if (requestId === vendorRequestRef.current) setVendorHubLoading(false);
    }
  };

  const openVendorDetail = async (vendorId) => {
    if (authState !== AUTH_STATES.REGISTERED || !authUserId || !vendorId) return;

    setViewMode('vendorDetail');
    setSelectedVendor(normalizeVendor(vendors.find((vendor) => vendor.id === vendorId)));
    setVendorDetailError('');
    setVendorHubUnsupported(false);

    if (apiClient.transport === 'gas') {
      setVendorHubUnsupported(true);
      return;
    }

    const requestId = ++vendorRequestRef.current;
    setVendorDetailLoading(true);
    try {
      const response = await apiClient.getVendor({
        vendorId,
        viewAsUserId: apiClient.transport === 'worker' ? viewAsUser?.userId : null
      });
      const data = await response.json();
      if (!response.ok || data?.success === false) {
        throw vendorResponseError(data, '店家詳細資料讀取失敗');
      }
      const vendor = normalizeVendor(data);
      if (!vendor) throw vendorResponseError(data, '店家詳細資料格式不正確');
      if (requestId !== vendorRequestRef.current) return;
      setSelectedVendor(vendor);
      setVendors((current) => current.map((item) => item.id === vendor.id ? vendor : item));
    } catch (error) {
      if (requestId !== vendorRequestRef.current) return;
      setVendorDetailError(getApiErrorPresentation(error, '讀取店家詳細資料').message);
    } finally {
      if (requestId === vendorRequestRef.current) setVendorDetailLoading(false);
    }
  };

  const handleVendorMetadataSave = async (vendorId, payload) => {
    if (!canAuth('manageVendors') || isViewAsMode) {
      throw new Error('目前身分沒有店家管理權限。');
    }
    const response = await apiClient.updateVendor({ vendorId, payload });
    const data = await response.json();
    if (!response.ok || data?.success === false) {
      throw vendorResponseError(data, '店家資料更新失敗');
    }
    const vendor = normalizeVendor(data);
    if (!vendor) throw vendorResponseError(data, '店家資料格式不正確');
    setSelectedVendor(vendor);
    setVendors((current) => current.map((item) => item.id === vendor.id ? vendor : item));
    setVendorDetailError('');
    return vendor;
  };

  const handleExitVendorHub = () => {
    vendorRequestRef.current += 1;
    setSelectedVendor(null);
    setVendorHubLoading(false);
    setVendorDetailLoading(false);
    setVendorHubError('');
    setVendorDetailError('');
    setVendorHubUnsupported(false);
    setViewMode('calendar');
  };

  const fetchUserAllOrders = async (uId, viewAsUserId = null, targetUserId = null) => {
    if (!uId) return false;
    const requestStartTime = getPerformanceNow();
    try {
      const res = await apiClient.getOrdersMap({
        userId: uId,
        viewAsUserId: apiClient.transport === 'worker' ? viewAsUserId : null,
        targetUserId: apiClient.transport === 'worker' ? targetUserId : null
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

  const refreshMyOrders = async () => {
    if (authState !== AUTH_STATES.REGISTERED || !authUserId) return;
    const requestId = ++myOrdersRequestRef.current;
    setMyOrdersLoading(true);
    setMyOrdersError('');
    try {
      if (apiClient.transport !== 'worker') throw new Error('WORKER_ONLY');
      const res = await apiClient.getOrdersHistory({
        viewAsUserId: viewAsUser?.userId || null,
        targetUserId: delegatedOrderUser?.userId || null
      });
      const data = await res.json();
      if (!res.ok || data?.success !== true || !Array.isArray(data.orders)) throw new Error('READ_FAILED');
      if (requestId === myOrdersRequestRef.current) setMyOrdersList(data.orders);
    } catch {
      if (requestId === myOrdersRequestRef.current) {
        setMyOrdersError('訂單紀錄讀取失敗，請稍後重試。');
        setMyOrdersList([]);
      }
    } finally {
      if (requestId === myOrdersRequestRef.current) setMyOrdersLoading(false);
    }
  };

  const refreshBentoFootprints = async (period = footprintsPeriod) => {
    if (authState !== AUTH_STATES.REGISTERED || !authUserId) return;
    const requestId = ++footprintsRequestRef.current;
    const subjectUserId = viewAsUser?.userId || authUserId;
    const cacheKey = JSON.stringify([subjectUserId, period]);
    const cached = footprintsCacheRef.current.get(cacheKey) || null;
    setFootprintsLoading(!cached);
    setFootprintsRefreshing(Boolean(cached));
    setFootprintsError('');
    setFootprintsData(cached);
    try {
      const res = await apiClient.getOrderStatistics({ period, viewAsUserId: viewAsUser?.userId || null });
      const data = await res.json();
      if (!res.ok || data?.success !== true
        || !Number.isFinite(Number(data.totalPortions))
        || !Number.isFinite(Number(data.totalOrderDays))
        || !Number.isFinite(Number(data.totalMealTypes))
        || !Array.isArray(data.vendors)
        || !Array.isArray(data.items)) throw new Error('READ_FAILED');
      const nextData = { ...data, _subjectUserId: subjectUserId };
      if (requestId === footprintsRequestRef.current) {
        footprintsCacheRef.current.set(cacheKey, nextData);
        setFootprintsData(nextData);
      }
    } catch {
      // Keep showing the last successful result when a background refresh fails.
      if (requestId === footprintsRequestRef.current && !cached) {
        setFootprintsError('便當足跡讀取失敗，請稍後重試。');
        setFootprintsData(null);
      }
    } finally {
      if (requestId === footprintsRequestRef.current) {
        setFootprintsLoading(false);
        setFootprintsRefreshing(false);
      }
    }
  };

  useEffect(() => {
    // A changed subject invalidates in-flight reads even if the tab is hidden.
    footprintsRequestRef.current += 1;
    setFootprintsData(null);
    setFootprintsLoading(false);
    setFootprintsRefreshing(false);
    setFootprintsError('');
    if (viewMode === 'footprints' && authState === AUTH_STATES.REGISTERED && authUser?.userId) {
      void refreshBentoFootprints(footprintsPeriod);
    }
    // Trigger only on subject/tab changes; period changes are handled by the period control.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewAsUser?.userId, authUser?.userId, viewMode, authState]);

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
        // Own current-month closing balance is the live balance; refresh the stale header/nav value (e.g. after admin top-up).
        const currentMonth = getTaipeiYearMonth();
        const closing = Number(data.closingBalance);
        if (!viewAsUserId && year === currentMonth.year && month === currentMonth.month && Number.isFinite(closing)) {
          setUserBalance(closing);
          setAuthUser(prev => (prev && prev.balance !== closing ? { ...prev, balance: closing } : prev));
        }
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
    setHistorySummaryExpanded(false);
    setShowHistoryModal(true);
    loadBalanceHistory(currentMonth.year, currentMonth.month, viewAsUser?.userId || null);
  };

  const openWalletPage = () => {
    if (!canAuth('viewOwnBalance') || isViewAsMode || delegatedOrderUser) return;
    const taipeiMonth = getTaipeiYearMonth();
    setSelectedYear(taipeiMonth.year);
    setSelectedMonth(taipeiMonth.month);
    setShowHistoryModal(false);
    setViewMode('wallet');
    void loadBalanceHistory(taipeiMonth.year, taipeiMonth.month, null);
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

    if (
      delegatedOrderUser
      && authUser?.role === 'ProxyAdmin'
      && dateStr < formatDateInput(new Date())
    ) {
      await showPopup({
        icon: 'info',
        title: '無法代點過去日期',
        text: 'ProxyAdmin 代點餐僅可選擇今天或未來已開團日期。'
      });
      return;
    }

    setSelectedDate(dateStr);
    setDailyFlavor(null);
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
    setActiveOrderReadOnly(false);
    setOrderPolicy(null);

    try {
      const res = await apiClient.getOrderPage({
        targetDate: dateStr,
        userId: authUserId,
        viewAsUserId: apiClient.transport === 'worker' ? viewAsUser?.userId : null,
        targetUserId: apiClient.transport === 'worker' ? delegatedOrderUser?.userId : null
      });
      const data = await res.json();
      if (data.success && data.myOrder && Array.isArray(data.myOrder.items)) {
        const workerOrderMode = apiClient.transport === 'worker';
        const orderMap = {};
        data.myOrder.items.forEach(item => {
          const selectionId = workerOrderMode
            ? getWorkerSelectionKey(item)
            : item.item_id;
          orderMap[selectionId] = item.quantity;
        });

        setSetting(data.setting);
        setDeadline(data.deadline);
        setOrderPolicy(data.orderPolicy || null);
        setMenu(workerOrderMode ? normalizeWorkerOrderMenu(data.menu) : data.menu);
        setDailyFlavor(workerOrderMode ? (data.dailyFlavor || null) : null);
        setImageLoadErrors({});
        setOrderItems(orderMap);
        setActiveOrderSnapshot(buildExistingOrderSubmission({
          order: data.myOrder,
          selectedDate: dateStr,
          vendor: data.setting?.vendor || '',
          fallbackFloor: data.targetUser?.defaultFloor
            || data.targetUser?.floor
            || defaultFloor
            || authUser?.defaultFloor
            || authUser?.floor
            || floor
        }));
        if (delegatedOrderUser && data.targetUser) {
          setDelegatedOrderUser(prev => prev ? { ...prev, ...data.targetUser } : prev);
          setFloor(data.targetUser.defaultFloor || data.targetUser.floor || floor);
        }
        setActiveOrderId(data.myOrder.orderId || '');
        setHasExistingOrder(data.myOrder.items.length > 0);
        setActiveOrderReadOnly(Boolean(data.myOrder.readOnly || data.myOrder.status === 'COMPLETED'));
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
      if (!normalizeVendorName(vendor) && apiClient.transport === 'worker') {
        const summaryResponse = await apiClient.getAdminSummary({ targetDate: dateStr });
        const summary = await summaryResponse.json();
        const orderCount = new Set(
          (summary.todayOrders || []).map((order) => order.order_id).filter(Boolean)
        ).size;
        const totalItems = Number(summary.totalItems || 0);
        const totalAmount = Number(summary.totalAmount || 0);
        const confirmation = await Swal.fire({
          icon: orderCount > 0 ? 'warning' : 'question',
          title: '確認取消開團？',
          html: orderCount > 0
            ? `<div class="text-left text-sm leading-7">
                <p><strong>${dateStr}</strong> 目前有 <strong>${orderCount}</strong> 筆訂單、<strong>${totalItems}</strong> 份餐點，總金額 <strong>${totalAmount}</strong>。</p>
                <p class="mt-2 text-rose-700"><strong>確認後會取消全部有效訂單，並將款項全額退回每位使用者餘額。</strong></p>
              </div>`
            : `<div class="text-sm">確認將 <strong>${dateStr}</strong> 設為不開團？目前沒有有效訂單需要退款。</div>`,
          showCancelButton: true,
          confirmButtonText: orderCount > 0 ? '取消開團並全額退款' : '確認不開團',
          cancelButtonText: '返回',
          confirmButtonColor: '#be123c',
          customClass: {
            popup: 'rounded-3xl',
            confirmButton: 'rounded-xl',
            cancelButton: 'rounded-xl'
          }
        });
        if (!confirmation.isConfirmed) return;
      }

      const res = await apiClient.setCalendarVendor({ adminUserId: authUserId, dateStr, vendor });
      const data = await res.json();
      if (data.success) {
        const cancelled = data.cancellationSummary;
        const message = cancelled?.orderCount > 0
          ? `已取消 ${cancelled.orderCount} 筆訂單、${cancelled.totalQuantity} 份餐點，並退款 ${cancelled.totalAmount}。`
          : '開團設定已更新！';
        await showPopup({ icon: 'success', title: '更新完成', text: message });
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
    setSpecialAdminVendorChoice(event
      ? normalizeVendorName(event.vendor)
      : CANONICAL_VENDOR_FALLBACKS[0]);
  };

  const handleSpecialAdminSaveVendor = () => saveAdminVendor(specialAdminDate, specialAdminVendorChoice);

  const handleSubmit = async () => {
    if (loading || orderMutationInFlightRef.current || authState !== AUTH_STATES.REGISTERED || !authUserId) return;
    if (activeOrderReadOnly) return;
    if (authUser?.profileComplete === false) {
      await showPopup({ icon: 'warning', title: '請先完成基本資料', text: '請先設定有效的領取樓層，再開始訂餐。' });
      return;
    }
    if (!(await guardWrite('訂單送出'))) return;
    if (orderMutationBlocked) {
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
    if (activeOrderReadOnly) {
      setShowOrderConfirmation(false);
      return;
    }
    orderMutationInFlightRef.current = true;
    try {
      if (!(await guardWrite('訂單送出'))) return;
      if (orderMutationBlocked) {
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
          targetUserId: delegatedOrderUser?.userId || null,
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
          ...(workerOrderMutation && delegatedOrderUser?.userId
            ? { targetUserId: delegatedOrderUser.userId }
            : {}),
          ...(workerOrderMutation ? { idempotencyKey: requestKey } : {})
        });
        const data = await res.json();
        if (data.success) {
          setShowOrderConfirmation(false);
          setMessage('✅ 下單成功');
          setHasExistingOrder(true);
          const isDelegatedOrder = Boolean(delegatedOrderUser?.userId);
          if (data.newBalance !== undefined && data.newBalance !== null) {
            if (isDelegatedOrder) {
              setDelegatedOrderUser(prev => prev ? { ...prev, balance: data.newBalance } : prev);
            } else {
              setUserBalance(data.newBalance);
              setAuthUser(prev => prev ? { ...prev, balance: data.newBalance } : prev);
            }
          }
          if (isDelegatedOrder) setMemberBalancesLoaded(false);
          setActiveOrderId(data.orderId || '');
          clearClientRequestKey(orderSubmitRequestRef);
          clearClientRequestKey(orderCancelRequestRef);
          await Promise.all([
            fetchCalendarEvents(authUserId),
            fetchUserAllOrders(
              delegatedOrderUser?.userId || authUserId,
              null,
              delegatedOrderUser?.userId || null
            )
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
      || activeOrderReadOnly
    ) return;
    if (!(await guardWrite('取消訂單'))) return;
    if (orderMutationBlocked) {
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
      || activeOrderReadOnly
    ) return;
    orderMutationInFlightRef.current = true;
    try {
      if (!(await guardWrite('取消訂單'))) return;
      if (orderMutationBlocked) {
        setShowCancelConfirmation(false);
        await showPopup({ icon: 'warning', title: '無法取消訂購', text: '已過截止時間，無法取消訂購！' });
        return;
      }

      const orderId = activeOrderId;
      const workerOrderMutation = apiClient.transport === 'worker';
      const cancelRequestKey = workerOrderMutation
        ? getStableClientRequestKey(orderCancelRequestRef, 'cancel', {
          orderId,
          targetDate: selectedDate,
          targetUserId: delegatedOrderUser?.userId || null
        })
        : null;

      setCancelError('');
      setLoading(true);
      try {
        const res = await apiClient.cancelOrder({
          userId: authUserId,
          orderId,
          date: selectedDate,
          ...(workerOrderMutation && delegatedOrderUser?.userId
            ? { targetUserId: delegatedOrderUser.userId }
            : {}),
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

        const isDelegatedOrder = Boolean(delegatedOrderUser?.userId);
        if (data.newBalance !== undefined && data.newBalance !== null) {
          if (isDelegatedOrder) {
            setDelegatedOrderUser(prev => prev ? { ...prev, balance: data.newBalance } : prev);
          } else {
            setUserBalance(data.newBalance);
            setAuthUser(prev => prev ? { ...prev, balance: data.newBalance } : prev);
          }
        }
        if (isDelegatedOrder) setMemberBalancesLoaded(false);
        const [calendarRefreshed, ordersRefreshed] = await Promise.all([
          fetchCalendarEvents(authUserId),
          fetchUserAllOrders(
            delegatedOrderUser?.userId || authUserId,
            null,
            delegatedOrderUser?.userId || null
          )
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
    setActiveOrderReadOnly(false);
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
    if (section === 'vendorOperations') {
      if (authRole !== 'Admin' || isViewAsMode) return;
      setAdminSection('vendorOperations');
      setViewMode('admin');
      return;
    }
    if (section === 'orders') {
      if (!can('viewAdminOrderSummary')) return;
      setAdminSection('orders');
      setViewMode('admin');
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
      return;
    }

    if (section === 'menuChanges') {
      if (!canManageAdminMenuChanges() || isViewAsMode) return;
      setAdminSection('menuChanges');
      setViewMode('admin');
      void loadAdminMenuChanges(true);
    }
  };

  const navigateBottomTab = (key) => {
    if (authRole === 'Vendor') {
      if (key === 'vendor' || key === 'calendar' || key === 'vendorFootprints') setViewMode(key);
      return;
    }
    if (key === 'calendar') {
      setAdminManageMode(false);
      setViewMode('calendar');
    } else if (key === 'myOrders') {
      setAdminManageMode(false);
      setViewMode('myOrders');
      void refreshMyOrders();
    } else if (key === 'footprints') {
      setAdminManageMode(false);
      setViewMode('footprints');
    } else if (key === 'wallet') {
      openWalletPage();
    } else if (key === 'admin' && !isViewAsMode && !delegatedOrderUser) {
      setAdminSection('hub');
      setViewMode('admin');
    }
  };

  const openAdminCalendar = (vendorName = '') => {
    if (!can('manageCalendar') || viewAsUser) return;
    setAdminSection('calendar');
    setViewMode('calendar');
    setAdminManageMode(true);
    const today = formatDateInput(new Date());
    setSpecialAdminDate(today);
    setSpecialAdminVendorChoice(normalizeVendorName(vendorName) || getConfiguredVendor(calendarEvents[today]));
  };

  const handleOpenViewAs = async (mode = 'view') => {
    const wantsViewAs = mode === 'view';
    const allowed = wantsViewAs ? canAuth('viewAsUser') : canAuth('delegateOrder');
    if (!allowed || viewAsUser || delegatedOrderUser) return;
    setEmployeeIdFilter('');
    setShowViewAsModal(true);
    setViewAsModalMode(mode);
    await (wantsViewAs ? loadMemberBalances() : loadOrderTargets());
  };

  const handleSelectViewAs = (user) => {
    // The Worker rejects View As for protected Vendor accounts; do not enter a view that cannot load.
    if (!user || !canAuth('viewAsUser') || user.role === 'Vendor') return;
    setViewAsUser(user);
    setDelegatedOrderUser(null);
    setShowViewAsModal(false);
    setViewAsModalMode(null);
    setEmployeeIdFilter('');
    setAdminManageMode(false);
    setSelectedAdminDate(null);
    setSelectedTopupUser(null);
    if (apiClient.transport === 'worker') {
      void fetchCalendarEvents(user.userId, user.userId);
      void fetchUserAllOrders(user.userId, user.userId);
    }
    if (hasPermission(
      user.role,
      'viewAdminOrderSummary',
      user.authMode || (
        user.authSource === 'EMPLOYEE_GUEST'
          ? 'employee_guest'
          : user.authSource === 'LINE'
            ? 'line'
            : user.authSource === 'EMPLOYEE' || user.authSource === 'NON_LINE'
              ? 'canonical'
              : 'line'
      ),
      user.authSource !== 'LINE' || Boolean(String(user.employeeId || '').trim())
    )) {
      setAdminSection('orders');
      setViewMode('admin');
      loadAdminSummary(selectedOrderDate, user.userId, true);
    } else {
      setAdminSection('orders');
      setViewMode('calendar');
    }
  };

  const handleSelectDelegatedOrder = (user) => {
    if (!user || apiClient.transport !== 'worker' || !canAuth('delegateOrder')) return;
    setDelegatedOrderUser(user);
    setViewAsUser(null);
    setShowViewAsModal(false);
    setViewAsModalMode(null);
    setEmployeeIdFilter('');
    setAdminManageMode(false);
    setSelectedAdminDate(null);
    setSelectedTopupUser(null);
    setFloor(user.defaultFloor || user.floor || '1樓');
    setAdminSection('orders');
    setViewMode('calendar');
    void fetchCalendarEvents(authUserId);
    void fetchUserAllOrders(user.userId, null, user.userId);
  };

  const handleExitViewAs = () => {
    if (!viewAsUser) return;
    setViewAsUser(null);
    setShowViewAsModal(false);
    setViewAsModalMode(null);
    setEmployeeIdFilter('');
    setSelectedTopupUser(null);
    setAdminManageMode(false);
    setSelectedAdminDate(null);
    if (apiClient.transport === 'worker') {
      void fetchCalendarEvents(authUserId, null);
      void fetchUserAllOrders(authUserId, null);
    }
    if (hasPermission(authUser?.role, 'viewMemberBalances', authMode, true)) {
      setAdminSection('balances');
      setViewMode('admin');
      void loadMemberBalances(true);
    } else if (hasPermission(authUser?.role, 'viewAdminOrderSummary', authMode, true)) {
      setAdminSection('orders');
      setViewMode('admin');
      loadAdminSummary(selectedOrderDate, null, true);
    } else {
      setAdminSection('orders');
      setViewMode('calendar');
    }
  };

  const handleExitDelegatedOrder = () => {
    if (!delegatedOrderUser) return;
    setDelegatedOrderUser(null);
    setShowViewAsModal(false);
    setViewAsModalMode(null);
    setEmployeeIdFilter('');
    setSelectedTopupUser(null);
    setAdminManageMode(false);
    setSelectedAdminDate(null);
    void fetchCalendarEvents(authUserId);
    void fetchUserAllOrders(authUserId, null, null);
    if (hasPermission(authUser?.role, 'viewMemberBalances', authMode, true)) {
      setAdminSection('balances');
      setViewMode('admin');
      void loadMemberBalances(true);
    } else {
      handleExitToCalendar();
    }
  };

  const handleOpenFloorModal = () => {
    if (!isRegistered || isViewAsMode || !authUser) return;
    setProfileNameDraft(authUser.name || authUser.displayName || name || '');
    setFloorDraft(authUser.defaultFloor || authUser.floor || defaultFloor || '1樓');
    setFloorError('');
    setShowFloorModal(true);
  };

  const handleSaveDefaultFloor = async () => {
    if (!authUser || isViewAsMode || floorLoading) return;

    const nextDisplayName = String(profileNameDraft || '').trim();
    if (!nextDisplayName || nextDisplayName.length > 100) {
      setFloorError('姓名不可為空白，且長度不可超過 100 個字元');
      return;
    }

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
      const res = await apiClient.updatePickupFloor({
        displayName: nextDisplayName,
        pickupFloor: nextFloor
      });
      if (!res.ok) {
        setFloorError(`更新失敗（HTTP ${res.status}）`);
        return;
      }

      const data = await res.json();
      if (!data.success || !data.user) {
        setFloorError(data.message || '目前無法更新預設領取樓層，請稍後再試。');
        return;
      }

      const canonicalName = data.user.name || data.user.displayName || nextDisplayName;
      const canonicalFloor = data.user.defaultFloor || data.user.floor || nextFloor;
      setAuthUser(prev => prev ? {
        ...prev,
        ...data.user,
        name: canonicalName,
        displayName: canonicalName,
        floor: canonicalFloor,
        defaultFloor: canonicalFloor
      } : prev);
      setName(canonicalName);
      setRegistrationDisplayName(canonicalName);
      setDefaultFloor(canonicalFloor);
      setFloor(canonicalFloor);
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
    setTopupMethod('TAIWAN_PAY');
    setTopupNote(formatTaipeiTopupNote());
    setTopupIdempotencyKey(createClientRequestKey('topup'));
  };

  const handleTopupSubmit = async () => {
    if (!selectedTopupUser || topupLoading || !can('topupMember')) return;
    if (!(await guardWrite('儲值'))) return;

    const amountText = String(topupAmount).trim();
    const amount = Number(amountText);
    const workerTopUp = apiClient.transport === 'worker';
    if (!topupMethod) {
      await showPopup({
        icon: 'warning',
        title: '儲值方式必填',
        text: '請選擇儲值方式後再確認。'
      });
      return;
    }
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
        topupMethod,
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

  const handleOpenEmployeeBindModal = (user) => {
    if (apiClient.transport !== 'worker'
      || !canAuth('bindEmployee')
      || isViewAsMode
      || !isEligibleEmployeeBindingTarget(user)) return;
    setSelectedEmployeeBindUser(user);
    setEmployeeBindId('');
    setEmployeeBindError('');
  };

  const handleEmployeeBindSubmit = async () => {
    if (!selectedEmployeeBindUser
      || employeeBindLoading
      || apiClient.transport !== 'worker'
      || !canAuth('bindEmployee')
      || isViewAsMode) return;
    if (!(await guardWrite('綁定員編'))) return;
    const employeeId = String(employeeBindId || '').trim();
    if (!employeeId) {
      setEmployeeBindError('請輸入員工編號。');
      return;
    }

    setEmployeeBindLoading(true);
    setEmployeeBindError('');
    try {
      const response = await apiClient.adminBindEmployee({
        userId: selectedEmployeeBindUser.userId,
        employeeId
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.user) {
        throw new Error(data.error || data.message || 'ADMIN_EMPLOYEE_BIND_FAILED');
      }

      // The binding response is not patched into local identity state. Read
      // both the actor and member list again so the server remains authoritative.
      const refreshedIdentity = await fetchUserInfo(readCurrentCredential());
      if (!refreshedIdentity?.success) throw new Error('ADMIN_EMPLOYEE_BIND_READBACK_FAILED');
      setMemberBalancesLoaded(false);
      await loadMemberBalances(true);
      setSelectedEmployeeBindUser(null);
      setEmployeeBindId('');
      await showPopup({
        icon: 'success',
        title: '員編綁定完成',
        text: '使用者原有角色與權限已保留。'
      });
    } catch (error) {
      const presentation = getApiErrorPresentation(error, '綁定員編');
      setEmployeeBindError(presentation.message);
      await showPopup({ icon: 'error', title: '員編綁定失敗', text: presentation.message });
    } finally {
      setEmployeeBindLoading(false);
    }
  };

  // Built on demand: some of these values are declared further down in this component.
  const getCalendarRenderContext = () => ({
    currentMonth,
    calendarEvents,
    userOrdersMap,
    calendarFlavorImageErrors,
    setCalendarFlavorImageErrors,
    likesLoaded,
    likeMutationInFlight,
    isViewAsMode,
    handleSelectDate,
    handleToggleLike,
    handleImagePreview
  });
  const renderCalendarDays = (dateList = null) => renderCalendarDaysFor(getCalendarRenderContext(), dateList);


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

  const dailyFlavorCard = useMemo(() => buildDailyFlavorCardModel({
    vendor: setting?.vendor,
    targetDate: selectedDate,
    dailyFlavor,
    menu
  }), [dailyFlavor, menu, selectedDate, setting?.vendor]);

  const groupedMenu = useMemo(() => {
    const groups = new Map();

    const dailyFlavorItemIds = new Set(
      (dailyFlavorCard?.items || []).map((item) => item.item_id)
    );
    menu.filter((item) => (
      !dailyFlavorItemIds.has(item.item_id)
      && (!dailyFlavorCard || !isDailyFlavorMenuItem(item))
    )).forEach(item => {
      const { baseName, variant } = parseMenuItemName(item.item_name);
      const groupKey = baseName || item.item_name;
      const group = groups.get(groupKey) || {
        baseName: groupKey,
        baseImageUrl: '',
        variantImageUrl: '',
        popularityRank: Number.isFinite(Number(item.popularity_rank))
          && item.popularity_rank !== null && item.popularity_rank !== undefined
          ? Number(item.popularity_rank) : Number.MAX_SAFE_INTEGER,
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
    })).sort((a, b) => a.popularityRank - b.popularityRank);
  }, [dailyFlavorCard, menu]);


  const aggregatedOrders = aggregateOrdersByFloor(adminSummary.todayOrders);
  const isRegistered = authState === AUTH_STATES.REGISTERED;
  const isUnregistered = authState === AUTH_STATES.UNREGISTERED;
  const isEmployeeBindRequired = authState === AUTH_STATES.EMPLOYEE_BIND_REQUIRED;
  const isGuestOnboarding = authMode === 'employee_guest'
    && authState === AUTH_STATES.UNVERIFIED;
  const authUserId = authUser?.userId || lineUserId;
  const authRole = authUser?.role || 'User';
  const isVendorAccount = authRole === 'Vendor';
  const effectiveUser = viewAsUser || authUser;
  const effectiveRole = effectiveUser?.role || 'User';
  const headerRoleLabel = ['Admin', 'ProxyAdmin'].includes(effectiveRole) ? effectiveRole : '';
  const isViewAsMode = Boolean(viewAsUser);
  const canPreviewModernCalendar = isRegistered && !isViewAsMode && !delegatedOrderUser;
  const effectiveCalendarUi = canPreviewModernCalendar ? calendarUi : 'classic';
  const selectCalendarUi = (nextUi) => {
    const next = nextUi === 'modern' || nextUi === 'rolling' ? nextUi : 'classic';
    setCalendarUi(next);
    try { window.localStorage.setItem('bento-calendar-ui', next); } catch { /* nonessential preference */ }
  };
  const can = (permission) => isRegistered
    && hasPermission(effectiveRole, permission, authMode, isRegistered);
  const canAuth = (permission) => isRegistered
    && hasPermission(authRole, permission, authMode, isRegistered);
  const hasManagementHub = canAuth('viewMemberBalances') || canAuth('viewAdminOrderSummary')
    || canAuth('manageMenu') || canAuth('manageAnnouncements');
  useEffect(() => {
    if (isRegistered && isVendorAccount) {
      setViewMode('vendor');
      setAdminManageMode(false);
      setViewAsUser(null);
      setDelegatedOrderUser(null);
    }
  }, [isRegistered, isVendorAccount]);
  useEffect(() => {
    if (!isRegistered || !isVendorAccount || !(apiClient.transport === 'worker' || authClient.isMock)) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const response = await apiClient.getVendorContext();
        if (!response.ok) return;
        const data = await response.json();
        const names = (Array.isArray(data?.vendors) ? data.vendors : [])
          .map((vendor) => String(vendor?.name || '').trim()).filter(Boolean);
        if (!cancelled) setVendorNames(names);
      } catch { /* the header just shows no store name */ }
    })();
    return () => { cancelled = true; };
  }, [isRegistered, isVendorAccount, authUser?.userId]);
  const authStateLabel = {
    [AUTH_STATES.AUTH_LOADING]: '身份驗證中',
    [AUTH_STATES.AUTH_REQUIRED]: '請登入 LINE',
    [AUTH_STATES.AUTH_FAILED]: '身份驗證失敗',
    [AUTH_STATES.UNREGISTERED]: '尚未註冊',
    [AUTH_STATES.EMPLOYEE_BIND_REQUIRED]: '尚未綁定員編',
    [AUTH_STATES.UNVERIFIED]: '員工訪客 onboarding',
    [AUTH_STATES.REGISTERED]: '已註冊'
  }[authState];
  const displayName = effectiveUser?.name || name || registrationDisplayName || authStateLabel;
  const displayFloor = effectiveUser?.defaultFloor || effectiveUser?.floor || defaultFloor;
  const displayBalance = effectiveUser?.balance ?? userBalance;
  const vendorOptions = useMemo(() => {
    const values = [
      ...vendors.map((vendor) => normalizeVendorName(vendor.name)),
      ...adminMenuVendors.map((vendor) => normalizeVendorName(
        typeof vendor === 'string' ? vendor : vendor?.name
      )),
      ...Object.values(calendarEvents).map((event) => normalizeVendorName(event?.vendor))
    ].filter(Boolean);
    const unique = Array.from(new Set(values));
    return unique.length > 0 ? unique : CANONICAL_VENDOR_FALLBACKS;
  }, [vendors, adminMenuVendors, calendarEvents]);
  const selectionRows = viewAsModalMode === 'delegate' ? orderTargetRows : adminMemberRows;
  const visibleSelectionRows = useMemo(
    () => filterMembersByEmployeeId(selectionRows, employeeIdFilter),
    [employeeIdFilter, selectionRows, viewAsModalMode]
  );
  const orderNavigationDates = useMemo(() => {
    const today = formatDateInput(new Date());
    return Object.entries(calendarEvents)
      .filter(([dateStr, event]) => {
        if (!event?.vendor) return false;
        if (delegatedOrderUser && authUser?.role === 'ProxyAdmin' && dateStr < today) return false;
        return true;
      })
      .map(([dateStr]) => dateStr)
      .sort();
  }, [calendarEvents, delegatedOrderUser, authUser?.role]);
  const selectedOrderNavigationIndex = selectedDate
    ? orderNavigationDates.indexOf(selectedDate)
    : -1;
  const previousOrderDate = selectedOrderNavigationIndex > 0
    ? orderNavigationDates[selectedOrderNavigationIndex - 1]
    : null;
  const nextOrderDate = selectedOrderNavigationIndex >= 0
    && selectedOrderNavigationIndex < orderNavigationDates.length - 1
    ? orderNavigationDates[selectedOrderNavigationIndex + 1]
    : null;

  const weekendEvents = renderWeekendEvents(getCalendarRenderContext());

  return (
    <div className="flex min-h-screen min-w-0 flex-col bg-[#F7F5F0] pb-24 text-gray-800">
      <header className="bg-[#2C4A3E] text-white p-4 shadow-md">
        <div className="max-w-xl mx-auto min-w-0">
          <h1 className="sr-only">蔬食便當預訂系統</h1>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 text-xs text-emerald-100">
            {isVendorAccount && vendorNames.length > 0 && <span className="font-bold text-white">{vendorNames.join('、')}</span>}
            {isVendorAccount && authMode === 'vendor_code' && (
              <button
                type="button"
                onClick={() => {
                  guestSessionStore.clearGuestSession({ reason: 'vendor-code-logout', notify: false });
                  window.location.reload();
                }}
                className="rounded bg-emerald-800/80 px-2 py-1 font-bold text-emerald-100 transition hover:bg-emerald-700"
              >
                登出
              </button>
            )}
            {!isVendorAccount && <span aria-hidden="true">👤</span>}
            {!isVendorAccount && headerRoleLabel && isRegistered && (
              <span className="rounded bg-emerald-800/80 px-1.5 py-0.5 font-bold">
                {headerRoleLabel}
              </span>
            )}
            {!isVendorAccount && (isViewAsMode || !isRegistered ? (
              <>
                <span>{displayName}</span>
                {displayFloor && (
                  <span className="rounded bg-emerald-900/80 px-1.5 py-0.5 font-bold text-emerald-100" aria-label={`目前預設領取樓層 ${displayFloor}`}>
                    {displayFloor}
                  </span>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={handleOpenFloorModal}
                aria-label={`修改個人資料，目前姓名 ${displayName}${displayFloor ? `，預設領取樓層 ${displayFloor}` : ''}`}
                className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 transition hover:bg-emerald-800/60 hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-300"
              >
                <span>{displayName}</span>
                {displayFloor && (
                  <span className="rounded bg-emerald-900/80 px-1.5 py-0.5 font-bold text-emerald-100">{displayFloor}</span>
                )}
                <span aria-hidden="true">›</span>
              </button>
            ))}
            <DevAuthBadge mode={authClient.mode} mockUser={authClient.mockUser} />
            <LocalUatBadge
              mode={authClient.mode}
              role={authUser?.role}
              onSwitch={() => {
                authClient.logoutLocalUat();
                window.location.reload();
              }}
            />
            {!isVendorAccount && isRegistered && apiClient.transport === 'worker' && getLineBindingState(authUser) !== 'BOUND' && (
              <IdentityStatusBadges fields={['lineBinding']} lineBound={authUser?.lineBound} lineUserId={authUser?.lineUserId} />
            )}
            {!isVendorAccount && canOfferLineBinding({ user: authUser, registered: isRegistered, transport: apiClient.transport, authMode, isViewAsMode })
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
            {isRegistered && !isViewAsMode && (apiClient.transport === 'worker' || authClient.isMock) && (
              <AnnouncementBell
                unreadCount={announcementUnreadCount + userNotifications.unreadCount}
                onClick={() => setShowAnnouncementModal(true)}
              />
            )}
          </div>
          <ViewAsBanner
            viewAsUser={isViewAsMode ? viewAsUser : null}
            delegatedOrderUser={delegatedOrderUser}
            authUser={authUser}
            displayBalance={displayBalance}
            onExit={handleExitViewAs}
            onExitDelegated={handleExitDelegatedOrder}
          />
        </div>
      </header>

      <main className="w-full max-w-xl min-w-0 mx-auto flex-1 p-4">
        <React.Suspense fallback={<LoadingNote label="畫面" />}>
        {apiClient.transport === 'worker'
          && authClient.isLocalUat
          && [AUTH_STATES.AUTH_REQUIRED, AUTH_STATES.AUTH_FAILED].includes(authState)
          && !loading
          && (
            <LocalUatLogin
              initialError={authState === AUTH_STATES.AUTH_FAILED ? authError : ''}
              onLogin={async ({ role, password }) => {
                await authClient.loginLocalUat({ role, password });
                window.location.reload();
              }}
            />
          )}

        {apiClient.transport === 'worker'
          && !authClient.isLocalUat
          && [AUTH_STATES.AUTH_REQUIRED, AUTH_STATES.AUTH_FAILED].includes(authState)
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
              onRetry={authState === AUTH_STATES.AUTH_FAILED
                ? () => initLiffAndFetchData({ force: true })
                : undefined}
              loading={employeeGuestLoading || lineBindLoading}
              error={employeeGuestError || (authState === AUTH_STATES.AUTH_FAILED ? authError : '')}
            />
          )}

        {apiClient.transport === 'worker'
          && [AUTH_STATES.UNREGISTERED, AUTH_STATES.EMPLOYEE_BIND_REQUIRED].includes(authState)
          && !loading
          && (
            <LineEmployeeLookup
              employeeId={employeeGuestId}
              onEmployeeIdChange={(value) => {
                setEmployeeGuestId(value);
                if (employeeGuestError) setEmployeeGuestError('');
              }}
              onSubmit={handleLineEmployeeBindRequired}
              bindingRequired={isEmployeeBindRequired}
              loading={lineBindLoading}
              error={employeeGuestError}
            />
          )}

        {apiClient.transport === 'worker'
          && isGuestOnboarding
          && !loading
          && (
            <ProvisionalEmployeeOnboarding
              employeeId={provisionalProfile.employeeId}
              displayName={provisionalProfile.displayName}
              onDisplayNameChange={(value) => {
                setEmployeeGuestSuccess('');
                setProvisionalProfile((current) => ({
                  ...current,
                  displayName: value
                }));
              }}
              pickupFloor={provisionalProfile.pickupFloor}
              onPickupFloorChange={(value) => {
                setEmployeeGuestSuccess('');
                setProvisionalProfile((current) => ({
                  ...current,
                  pickupFloor: value
                }));
              }}
              onSubmit={handleProvisionalProfileSubmit}
              loading={lineBindLoading}
              error={employeeGuestError}
              success={employeeGuestSuccess}
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
          <LoadingNote label="資料" />
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

        {isRegistered && isVendorAccount && viewMode === 'vendor' && !loading && (
          <VendorOperationsPage role="Vendor" mock={authClient.isMock} readOnly={authMode === 'vendor_code'} />
        )}
        {isRegistered && isVendorAccount && viewMode === 'calendar' && !loading && (
          <VendorCalendar />
        )}
        {isRegistered && isVendorAccount && viewMode === 'vendorFootprints' && !loading && (
          <VendorFootprints />
        )}

        {isRegistered && !isVendorAccount && viewMode === 'calendar' && !loading && effectiveCalendarUi === 'modern' && !adminManageMode && (
          <ModernCalendar currentMonth={currentMonth} events={calendarEvents} orders={userOrdersMap}
            onSelectDate={handleSelectDate}
            selectedKey={selectedCalendarKey}
            onSelectKey={setSelectedCalendarKey}
            onPreviousMonth={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
            onNextMonth={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))} />
        )}
        {isRegistered && !isVendorAccount && viewMode === 'calendar' && !loading && effectiveCalendarUi === 'rolling' && !adminManageMode && (
          <RollingCalendar renderCalendarDays={renderCalendarDays} />
        )}
        {isRegistered && !isVendorAccount && viewMode === 'calendar' && !loading && (effectiveCalendarUi === 'classic' || adminManageMode) && (
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
            vendorOptions={vendorOptions}
            loading={loading}
            renderCalendarDays={renderCalendarDays}
            weekendEvents={weekendEvents}
          />
        )}

        {isRegistered && !isVendorAccount && ['vendors', 'vendorDetail'].includes(viewMode) && !loading && (
          <VendorHub
            vendors={vendors}
            selectedVendor={selectedVendor}
            loading={vendorHubLoading}
            detailLoading={vendorDetailLoading}
            error={vendorHubError}
            detailError={vendorDetailError}
            gasUnsupported={vendorHubUnsupported}
            canManageVendors={canAuth('manageVendors') && !isViewAsMode}
            canManageCalendar={can('manageCalendar') && !isViewAsMode}
            isViewAsMode={isViewAsMode}
            onRetry={openVendorHub}
            onSelectVendor={openVendorDetail}
            onBackToList={() => {
              setSelectedVendor(null);
              setVendorDetailError('');
              setViewMode('vendors');
            }}
            onBackToCalendar={handleExitVendorHub}
            onSaveVendor={handleVendorMetadataSave}
            onOpenGroupManagement={openAdminCalendar}
          />
        )}

        {isRegistered && !isVendorAccount && viewMode === 'order' && !loading && (
          <OrderPage
            selectedDate={selectedDate}
            previousDate={previousOrderDate}
            nextDate={nextOrderDate}
            onPreviousDate={() => previousOrderDate && handleSelectDate(previousOrderDate)}
            onNextDate={() => nextOrderDate && handleSelectDate(nextOrderDate)}
            setting={setting}
            isExpired={isOrderExpired}
            deadlineAt={deadline?.deadline || null}
            cutoffPassed={isExpired && !isOrderExpired}
            policyBlocked={orderPolicyBlocked}
            readOnly={activeOrderReadOnly}
            isViewAsMode={isViewAsMode}
            floor={floor}
            onFloorChange={setFloor}
            orderNote={orderNote}
            onOrderNoteChange={setOrderNote}
            dailyFlavorCard={dailyFlavorCard}
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

        {isRegistered && !isVendorAccount && viewMode === 'myOrders' && !loading && (
          <MyOrdersPage orders={myOrdersList} loading={myOrdersLoading}
            error={myOrdersError} onRefresh={refreshMyOrders} isViewAsMode={isViewAsMode} />
        )}

        {isRegistered && !isVendorAccount && viewMode === 'footprints' && !loading && (
          <MyBentoFootprintsPage
            data={footprintsData?._subjectUserId === (viewAsUser?.userId || authUserId) ? footprintsData : null}
            isViewAsMode={isViewAsMode}
            loading={footprintsLoading}
            refreshing={footprintsRefreshing}
            error={footprintsError}
            period={footprintsPeriod}
            onPeriodChange={(period) => {
              setFootprintsPeriod(period);
              void refreshBentoFootprints(period);
            }}
            onRefresh={() => void refreshBentoFootprints(footprintsPeriod)}
          />
        )}

        {isRegistered && !isVendorAccount && viewMode === 'wallet' && !loading && canAuth('viewOwnBalance')
          && !isViewAsMode && !delegatedOrderUser && (
          <WalletPage balance={displayBalance} year={selectedYear} month={selectedMonth}
            history={historyList} summary={historySummary} loading={historyLoading}
            error={historyError} onMonthShift={shiftHistoryMonth} />
        )}

        {isRegistered && !isVendorAccount && viewMode === 'admin' && !loading && (
          <div className="space-y-4">
            {adminSection !== 'hub' && (
              <button type="button" onClick={() => setAdminSection('hub')} className="min-h-11 text-sm font-bold text-emerald-800 hover:underline">← 管理中心</button>
            )}
            {adminSection === 'hub' && (
              <AdminHub
                authRole={authRole}
                canAuth={canAuth}
                hasManagementHub={hasManagementHub}
                showLineNotify={apiClient.transport === 'worker' || authClient.isMock}
                effectiveCalendarUi={effectiveCalendarUi}
                handleAdminSectionChange={handleAdminSectionChange}
                openAdminCalendar={openAdminCalendar}
                openVendorHub={openVendorHub}
                handleOpenViewAs={handleOpenViewAs}
                selectCalendarUi={selectCalendarUi}
              />
            )}
            {adminSection === 'lineNotify' && (
              <section aria-label="LINE 通知設定" className="space-y-3">
                <h2 className="text-xl font-bold text-[#2C4A3E]">LINE 通知設定</h2>
                <OrderReminderSettings api={apiClient} defaultOpen />
              </section>
            )}
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

            {adminSection === 'vendorOperations' && authRole === 'Admin' && !isViewAsMode && (
              <VendorOperationsPage role="Admin" mock={authClient.isMock} />
            )}

            {adminSection === 'balances' && can('viewMemberBalances') && (
              <MemberBalanceManagement
                memberBalances={memberBalances}
                memberBalancesLoading={memberBalancesLoading}
                memberBalancesError={memberBalancesError}
                canTopup={can('topupMember')}
                canBindEmployee={apiClient.transport === 'worker' && canAuth('bindEmployee')}
                canViewAsUser={canAuth('viewAsUser') && !isViewAsMode}
                canDelegateOrder={apiClient.transport === 'worker' && canAuth('delegateOrder') && !isViewAsMode}
                canTransferLineBinding={apiClient.transport === 'worker' && authMode === 'line' && authUser?.role === 'Admin' && !isViewAsMode}
                canRepairInvalidEmployee={((apiClient.transport === 'worker' && authMode === 'line') || (apiClient.transport === 'mock' && import.meta.env.DEV)) && authUser?.role === 'Admin' && !isViewAsMode}
                includeInvalidMembers={includeInvalidMembers}
                onIncludeInvalidMembersChange={(includeInvalid) => {
                  setIncludeInvalidMembers(includeInvalid);
                  return loadMemberBalances(true, includeInvalid);
                }}
                onInvalidEmployeeRepairCompleted={() => loadMemberBalances(true)}
                onViewAsUser={handleSelectViewAs}
                onDelegateOrderUser={handleSelectDelegatedOrder}
                isViewAsMode={isViewAsMode}
                onOpenTopupModal={handleOpenTopupModal}
                onOpenEmployeeBindModal={handleOpenEmployeeBindModal}
                onUserNameUpdated={() => loadMemberBalances(true)}
                canManageRoles={apiClient.transport === 'worker' && authMode === 'line' && authUser?.role === 'Admin' && !isViewAsMode}
                onLineBindingTransferCompleted={() => loadMemberBalances(true)}
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
                onRefresh={async () => {
                  await loadAdminAnnouncements(true);
                  await refreshPublicAnnouncements();
                }}
                onCreate={createAdminAnnouncement}
                onUpdate={updateAdminAnnouncement}
                onDelete={deleteAdminAnnouncement}
              />
            )}
            {adminSection === 'menuChanges'
              && apiClient.transport === 'worker'
              && canAuth('manageMenu')
              && !isViewAsMode && (
              <MenuItemChangesManagement
                changes={adminMenuChanges}
                vendorOptions={adminMenuVendors}
                loading={adminMenuChangesLoading}
                error={adminMenuChangesError}
                isViewAsMode={isViewAsMode}
                onRefresh={() => loadAdminMenuChanges(true)}
                onCreate={createAdminMenuChange}
                onPreview={previewAdminMenu}
                onGetDailyFlavorSyncStatus={getAdminDailyFlavorSyncStatus}
                onSyncDailyFlavors={syncAdminDailyFlavors}
              />
            )}
          </div>
        )}

        </React.Suspense>
      </main>

      {isRegistered && viewMode !== 'order' && (
        <BottomNavigation current={viewMode} onNavigate={navigateBottomTab} role={authRole}
          balance={displayBalance} balanceKnown={(effectiveUser?.balance ?? authUser?.balance) != null && Number.isFinite(Number(effectiveUser?.balance ?? authUser?.balance))}
          canViewWallet={canAuth('viewOwnBalance') && !isViewAsMode && !delegatedOrderUser}
          canManage={!isViewAsMode && !delegatedOrderUser} />
      )}
      <footer className="mx-auto w-full max-w-xl px-4 py-4 text-center text-xs text-gray-400">
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
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4 shadow-lg z-40" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}>
          <div className="max-w-xl mx-auto flex justify-between items-center">
            <div>
              <div className="text-xs text-gray-500">
                已選 <span className="font-bold bg-gray-100 px-1.5 py-0.5 rounded text-gray-800 border">{totalCount}</span> 份便當
              </div>
              <div className="text-xl font-bold text-[#2C4A3E]">${totalAmount}</div>
            </div>
            {orderControlsOpen ? (
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={handleExitToCalendar}
                  disabled={loading || orderMutationInFlightRef.current}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  返回
                </button>
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
        <BalanceHistoryModal
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          historyList={historyList}
          historySummary={historySummary}
          historyLoading={historyLoading}
          historyError={historyError}
          historySummaryExpanded={historySummaryExpanded}
          setHistorySummaryExpanded={setHistorySummaryExpanded}
          shiftHistoryMonth={shiftHistoryMonth}
          onClose={() => setShowHistoryModal(false)}
        />
      )}

      {showViewAsModal
        && (viewAsModalMode === 'view' ? canAuth('viewAsUser') : canAuth('delegateOrder'))
        && !isViewAsMode
        && !delegatedOrderUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-opacity">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl border border-emerald-100">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <div>
                <h3 className="font-bold text-base text-[#2C4A3E]">
                  {viewAsModalMode === 'view' ? '👁 以其他身分檢視' : '🍱 選擇代點餐對象'}
                </h3>
                <p className="text-xs text-gray-500 mt-1">
                  {viewAsModalMode === 'view'
                    ? '檢視身分僅供預覽；代點餐是獨立且明確的操作模式。'
                    : '代點餐會以目前登入者身分執行，訂單與餘額歸屬所選成員。'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowViewAsModal(false);
                  setViewAsModalMode(null);
                  setViewAsLedgerUser(null);
                  setEmployeeIdFilter('');
                }}
                className="text-gray-400 hover:text-rose-500 text-lg font-bold bg-gray-50 hover:bg-rose-50 rounded-full w-8 h-8 flex items-center justify-center transition-colors"
              >
                ✕
              </button>
            </div>

            {!viewAsLedgerUser && (
              <label className="block space-y-1" htmlFor="delegate-employee-id-filter">
                <span className="block text-xs font-bold text-gray-600">員編篩選</span>
                <input
                  id="delegate-employee-id-filter"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  value={employeeIdFilter}
                  onChange={(event) => setEmployeeIdFilter(event.target.value)}
                  placeholder="輸入員編篩選"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                />
              </label>
            )}

            {viewAsModalMode === 'view' && viewAsLedgerUser ? (
              <AdminUserLedgerDetails user={viewAsLedgerUser} onBack={() => setViewAsLedgerUser(null)} />
            ) : (viewAsModalMode === 'view' ? memberBalancesLoading : orderTargetsLoading) ? (
              <p className="text-center text-sm text-emerald-800 animate-pulse py-6">成員列表載入中…</p>
            ) : (viewAsModalMode === 'view' ? memberBalancesError : orderTargetsError) ? (
              <div className="text-center text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-xl p-4">
                {viewAsModalMode === 'view' ? memberBalancesError : orderTargetsError}
              </div>
            ) : visibleSelectionRows.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-6">
                {employeeIdFilter.trim()
                  ? '找不到符合此員編的成員'
                  : '目前沒有可檢視的成員資料'}
              </p>
            ) : (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                {visibleSelectionRows.map((user, idx) => (
                  <div
                    key={user.userId || `view-as-${idx}`}
                    className="rounded-2xl border border-gray-100 bg-gray-50 p-3 transition-colors"
                  >
                    <span className="block truncate font-bold text-gray-800">{user.name || '未命名使用者'}</span>
                    <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-xs text-gray-500">
                      <span className="whitespace-nowrap">員編 {formatEmployeeId(user.employeeId)}</span>
                      <span className="whitespace-nowrap">· {user.floor || '未設定'}</span>
                      <span className="whitespace-nowrap">· {user.role || 'User'}</span>
                    </span>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {viewAsModalMode === 'view' && (user.role === 'Vendor' ? (
                        <span className="flex flex-col items-start gap-0.5">
                          <button
                            type="button"
                            disabled
                            aria-disabled="true"
                            className="cursor-not-allowed rounded-lg bg-slate-300 px-2.5 py-1.5 text-xs font-bold text-slate-500"
                          >
                            👁 檢視
                          </button>
                          <span className="text-xs text-gray-500">廠商帳號不可檢視身分</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSelectViewAs(user)}
                          className="rounded-lg bg-emerald-800 px-2.5 py-1.5 text-xs font-bold text-white shadow-sm"
                        >
                          👁 檢視
                        </button>
                      ))}
                      {viewAsModalMode === 'view' && can('viewMemberBalances') && apiClient.transport === 'worker' && user.userId && (
                        <button type="button" onClick={() => setViewAsLedgerUser(user)} className="rounded-lg border border-emerald-700 px-2.5 py-1.5 text-xs font-bold text-emerald-800">餘額與交易明細</button>
                      )}
                      {viewAsModalMode === 'delegate' && (
                        <button
                          type="button"
                          onClick={() => handleSelectDelegatedOrder(user)}
                          className="rounded-lg bg-sky-700 px-2.5 py-1.5 text-xs font-bold text-white shadow-sm"
                        >
                          🍱 代點餐
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {selectedEmployeeBindUser && apiClient.transport === 'worker'
        && canAuth('bindEmployee') && !isViewAsMode && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-opacity">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-5 shadow-2xl border border-amber-100">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <div>
                <h3 className="font-bold text-base text-[#2C4A3E]">綁定員編</h3>
                <p className="text-xs text-gray-500 mt-1">{selectedEmployeeBindUser.name || '未命名使用者'} 的 Admin 綁定操作</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEmployeeBindUser(null)}
                disabled={employeeBindLoading}
                className="text-gray-400 hover:text-rose-500 text-lg font-bold bg-gray-50 hover:bg-rose-50 rounded-full w-8 h-8 flex items-center justify-center transition-colors disabled:opacity-50"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3">
              <p className="rounded-2xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                此操作只綁定員工編號，不會變更既有角色或餘額；Worker 會檢查員工編號的 ownership conflict。
              </p>
              <label className="block text-gray-600 font-bold text-sm" htmlFor="employee-bind-id">員工編號</label>
              <input
                id="employee-bind-id"
                type="text"
                inputMode="text"
                autoComplete="off"
                value={employeeBindId}
                onChange={(event) => setEmployeeBindId(event.target.value)}
                disabled={employeeBindLoading}
                className="w-full border border-gray-200 rounded-2xl p-3.5 bg-gray-50 text-sm uppercase focus:outline-amber-600 focus:bg-white transition-colors shadow-sm disabled:bg-gray-100"
              />
              {employeeBindError && (
                <p className="rounded-xl bg-rose-50 border border-rose-100 p-3 text-xs text-rose-700" role="alert">
                  {employeeBindError}
                </p>
              )}
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSelectedEmployeeBindUser(null)}
                disabled={employeeBindLoading}
                className="w-1/2 bg-gray-100 text-gray-600 py-3 rounded-2xl text-sm font-bold hover:bg-gray-200 transition active:scale-95 shadow-sm disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleEmployeeBindSubmit}
                disabled={employeeBindLoading}
                className="w-1/2 bg-amber-600 text-white py-3 rounded-2xl text-sm font-bold hover:bg-amber-500 disabled:bg-gray-300 transition active:scale-95 shadow-md"
              >
                {employeeBindLoading ? '處理中...' : '確認綁定'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedTopupUser && can('topupMember') && !isViewAsMode && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-opacity">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-5 shadow-2xl transform transition-all border border-emerald-100">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <h3 className="font-bold text-base text-[#2C4A3E] flex items-center gap-2">
                儲值：{selectedTopupUser.name}
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
                <label className="block text-gray-600 font-bold mb-2 text-sm" htmlFor="topup-method">儲值方式</label>
                <select
                  id="topup-method"
                  required
                  aria-required="true"
                  value={topupMethod}
                  onChange={(e) => setTopupMethod(e.target.value)}
                  disabled={topupLoading}
                  className="w-full border border-gray-200 rounded-2xl p-3.5 bg-gray-50 text-sm focus:outline-emerald-600 focus:bg-white transition-colors shadow-sm disabled:bg-gray-100"
                >
                  {TOPUP_METHOD_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
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
                disabled={topupLoading || !topupMethod}
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
                  {vendorOptions.map((vendor) => (
                    <option key={vendor} value={vendor}>{vendor}</option>
                  ))}
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
        displayName={profileNameDraft}
        floor={floorDraft}
        loading={floorLoading}
        error={floorError}
        onDisplayNameChange={setProfileNameDraft}
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

      <AnnouncementInbox
        open={showAnnouncementModal}
        announcements={announcements}
        unreadCount={announcementUnreadCount}
        notifications={userNotifications.notifications}
        announcementsAvailable={!isVendorSession}
        onReadNotification={(notification) => { void userNotifications.markRead(notification); }}
        loading={announcementInboxLoading || !announcementsLoaded}
        error={announcementInboxError}
        onRetry={() => { void loadAnnouncementInbox(); }}
        onRead={(announcement) => { void markAnnouncementRead(announcement); }}
        onClose={() => setShowAnnouncementModal(false)}
      />

      <AnnouncementPopup
        key={announcementPopup?.id || 'announcement-popup-empty'}
        announcement={announcementPopup}
        loading={announcementPopupDismissLoading}
        error={announcementPopupDismissError}
        onClose={closeAnnouncementPopup}
        onDismiss={() => { void dismissAnnouncementPopup(); }}
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
