import React, { useState, useEffect, useMemo } from 'react';
import liff from '@line/liff';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';

// 自動根據目前環境讀取對應的變數
const GAS_API_URL = import.meta.env.VITE_GAS_API_URL;
const LIFF_ID = import.meta.env.VITE_LIFF_ID;

if (!GAS_API_URL) {
  throw new Error('Missing VITE_GAS_API_URL');
}

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

const formatDateInput = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function App() {
  const [viewMode, setViewMode] = useState('calendar');
  const [calendarEvents, setCalendarEvents] = useState({});
  const [userOrdersMap, setUserOrdersMap] = useState({});
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const [lineUserId, setLineUserId] = useState('');
  const [userRole, setUserRole] = useState('User');
  const [userBalance, setUserBalance] = useState(0);
  const [defaultFloor, setDefaultFloor] = useState('');
  const [identityError, setIdentityError] = useState('');

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

  const [adminSummary, setAdminSummary] = useState({ usersSummary: [], todayOrders: [], requesterRole: 'User' });

  // 餘額歷史彈窗狀態
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyList, setHistoryList] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedTopupUser, setSelectedTopupUser] = useState(null);
  const [topupAmount, setTopupAmount] = useState('');
  const [topupNote, setTopupNote] = useState('現金收款');
  const [topupLoading, setTopupLoading] = useState(false);

  // Admin 管理月曆彈窗狀態
  const [adminManageMode, setAdminManageMode] = useState(false);
  const [selectedAdminDate, setSelectedAdminDate] = useState(null);
  const [adminVendorChoice, setAdminVendorChoice] = useState('蔡老師');
  const [showSpecialAdminModal, setShowSpecialAdminModal] = useState(false);
  const [specialAdminDate, setSpecialAdminDate] = useState(formatDateInput(new Date()));
  const [specialAdminVendorChoice, setSpecialAdminVendorChoice] = useState('蔡老師');

  const isExpired = Boolean(deadline?.isExpired || deadline?.expired);

  useEffect(() => {
    initLiffAndFetchData();
  }, []);

  const initLiffAndFetchData = async () => {
    setLoading(true);
    try {
      await liff.init({ liffId: LIFF_ID });
      let currentUId = '';
      if (liff.isLoggedIn()) {
        const profile = await liff.getProfile();
        currentUId = profile.userId;
        setLineUserId(profile.userId);

        const user = await fetchUserInfo(profile.userId);
        if (user) {
          prefetchAdminSummary(profile.userId);
          fetchUserAllOrders(profile.userId);
        }
      } else {
        liff.login();
      }
      await fetchCalendarEvents(currentUId);
    } catch (err) {
      console.error("LIFF 初始化或讀取失敗", err);
    } finally {
      setLoading(false);
    }
  };

  const prefetchAdminSummary = async (uId) => {
    const targetUserId = uId || lineUserId;
    if (!targetUserId) return;

    try {
      const res = await fetch(`${GAS_API_URL}?action=getAdminSummary&userId=${targetUserId}&t=${Date.now()}`);
      const data = await res.json();
      if (data.success) {
        setAdminSummary({
          usersSummary: data.usersSummary || [],
          todayOrders: data.todayOrders || [],
          requesterRole: data.requesterRole || userRole
        });
      }
    } catch (err) {
      console.warn("背景預載總表失敗", err);
    }
  };

  const fetchUserInfo = async (uId) => {
    try {
      const res = await fetch(`${GAS_API_URL}?action=getUserInfo&userId=${encodeURIComponent(uId)}&t=${Date.now()}`);
      const data = await res.json();
      if (data.success && data.user) {
        setIdentityError('');
        setUserBalance(data.user.balance || 0);
        setUserRole(data.user.role || 'User');
        setName(data.user.name || '');
        setDefaultFloor(data.user.defaultFloor || data.user.floor || '');
        setFloor(data.user.defaultFloor || data.user.floor || '');
        return data.user;
      }
      setIdentityError(data.message || '此 LINE 帳號尚未註冊，請聯絡管理員。');
      setName('');
      setDefaultFloor('');
      setUserRole('User');
    } catch (err) {
      console.error("讀取個人餘額失敗", err);
      setIdentityError('目前無法驗證 LINE 身份，請稍後再試。');
    }
    return null;
  };

  const fetchCalendarEvents = async (uId) => {
    const targetId = uId || lineUserId;
    try {
      const res = await fetch(`${GAS_API_URL}?action=getCalendarEvents&userId=${targetId}&t=${Date.now()}`);
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
      const res = await fetch(`${GAS_API_URL}?action=getUserAllOrdersMap&userId=${encodeURIComponent(uId)}&t=${Date.now()}`);
      const data = await res.json();
      if (data.success) {
        setUserOrdersMap(data.ordersMap || {});
      }
    } catch (err) {
      console.error("讀取個人訂單圖譜失敗", err);
    }
  };

  const fetchBalanceHistory = async () => {
    if (!lineUserId || identityError) return;
    setShowHistoryModal(true);
    setHistoryLoading(true);
    try {
      const res = await fetch(`${GAS_API_URL}?action=getBalanceHistory&userId=${encodeURIComponent(lineUserId)}&t=${Date.now()}`);
      const data = await res.json();
      if (data.success) {
        setHistoryList(data.history || []);
      }
    } catch (err) {
      await showPopup({ icon: 'error', title: '讀取失敗', text: '無法讀取交易歷史明細' });
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleToggleLike = async (e, dateStr) => {
    e.stopPropagation(); // 防止觸發進入點餐頁面
    if (!lineUserId || identityError) {
      await showPopup({ icon: 'warning', title: '需要已註冊 LINE 身份', text: identityError || '請先於 LINE 內開啟本應用' });
      return;
    }

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
      const res = await fetch(GAS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'toggleLike',
          date: dateStr,
          userId: lineUserId
        })
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
    if (!lineUserId || identityError) {
      await showPopup({ icon: 'warning', title: '無法訂餐', text: identityError || '目前無法驗證 LINE 身份' });
      return;
    }

    const event = calendarEvents[dateStr];

    if (adminManageMode && (userRole === 'Admin' || adminSummary.requesterRole === 'Admin')) {
      setSelectedAdminDate(dateStr);
      setAdminVendorChoice(event?.vendor || '蔡老師');
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
      const res = await fetch(`${GAS_API_URL}?action=getInitData&targetDate=${dateStr}&t=${Date.now()}`);
      const data = await res.json();
      if (data.success) {
        setSetting(data.setting);
        setDeadline(data.deadline);
        setMenu(data.menu);
        setImageLoadErrors({});
        setViewMode('order');

        if (lineUserId) {
          fetchUserOrder(lineUserId, dateStr);
        }
      } else {
        await showPopup({ icon: 'error', title: '讀取失敗', text: data.message || '讀取失敗' });
      }
    } catch (err) {
      await showPopup({ icon: 'error', title: '連線錯誤', text: '目前無法讀取菜單，請稍後再試。' });
    } finally {
      setLoading(false);
    }
  };

  const saveAdminVendor = async (dateStr, vendor) => {
    if (!dateStr) return;
    setLoading(true);
    try {
      const res = await fetch(GAS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'adminSetVendor',
          adminUserId: lineUserId,
          dateStr,
          vendor
        })
      });
      const data = await res.json();
      if (data.success) {
        await showPopup({ icon: 'success', title: '更新完成', text: '開團設定已更新！' });
        setSelectedAdminDate(null);
        setShowSpecialAdminModal(false);
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

  const handleOpenSpecialAdminModal = () => {
    setSpecialAdminDate(formatDateInput(new Date()));
    setSpecialAdminVendorChoice('蔡老師');
    setShowSpecialAdminModal(true);
  };

  const handleSpecialAdminSaveVendor = () => saveAdminVendor(specialAdminDate, specialAdminVendorChoice);

  const fetchUserOrder = async (uId, targetDate) => {
    if (!uId || !targetDate) return;
    try {
      const res = await fetch(`${GAS_API_URL}?action=getUserOrder&userId=${encodeURIComponent(uId)}&date=${targetDate}`);
      const data = await res.json();
      if (data.success && data.items) {
        const orderMap = {};
        data.items.forEach(item => {
          orderMap[item.item_id] = item.quantity;
        });
        setOrderItems(orderMap);
        setActiveOrderId(data.orderId || '');
        setHasExistingOrder(data.items.length > 0);
        setOrderNote(data.note || '');
      } else {
        setOrderItems({});
        setActiveOrderId('');
        setOrderNote('');
        setHasExistingOrder(false);
      }
    } catch (err) {
      console.error("查詢舊訂單失敗", err);
    }
  };

  const handleSubmit = async () => {
    if (loading || identityError || !lineUserId) return;
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
      const res = await fetch(GAS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'submitOrder',
          userId: lineUserId,
          pickup_floor: floor,
          target_date: selectedDate,
          items,
          note: orderNote
        })
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
        fetchUserAllOrders(lineUserId);
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
    if (loading || !activeOrderId || !lineUserId || identityError) return;
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
      const res = await fetch(GAS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'cancelOrder',
          userId: lineUserId,
          orderId: activeOrderId,
          date: selectedDate
        })
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
        fetchUserAllOrders(lineUserId);
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

  const fetchAdminSummary = async () => {
    const hasCache = adminSummary.usersSummary.length > 0 || adminSummary.todayOrders.length > 0;

    if (hasCache) {
      setViewMode('admin');
    } else {
      setLoading(true);
    }

    try {
      const res = await fetch(`${GAS_API_URL}?action=getAdminSummary&userId=${lineUserId}&t=${Date.now()}`);
      const data = await res.json();
      if (data.success) {
        setAdminSummary({
          usersSummary: data.usersSummary || [],
          todayOrders: data.todayOrders || [],
          requesterRole: data.requesterRole || userRole
        });
        if (!hasCache) setViewMode('admin');
      } else if (!hasCache) {
        await showPopup({ icon: 'error', title: '無法取得總表', text: data.message || '無法取得總表' });
      }
    } catch (err) {
      if (!hasCache) await showPopup({ icon: 'error', title: '總表連線失敗', text: '目前無法取得管理總表，請稍後再試。' });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenTopupModal = (user) => {
    setSelectedTopupUser(user);
    setTopupAmount('');
    setTopupNote('現金收款');
  };

  const handleTopupSubmit = async () => {
    if (!selectedTopupUser || topupLoading || !isAdminUser) return;

    const amountText = String(topupAmount).trim();
    const amount = Number(amountText);
    if (!amountText || !Number.isFinite(amount) || amount <= 0) {
      await showPopup({ icon: 'warning', title: '金額不正確', text: '儲值金額必須大於 0。' });
      return;
    }

    setTopupLoading(true);
    try {
      const res = await fetch(GAS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'topUpBalance',
          adminUserId: lineUserId,
          targetUserId: selectedTopupUser.userId,
          amount,
          note: topupNote.trim()
        })
      });
      const data = await res.json();
      if (!data.success) {
        await showPopup({ icon: 'error', title: '儲值失敗', text: data.message || '儲值失敗' });
        return;
      }

      setAdminSummary(prev => ({
        ...prev,
        usersSummary: prev.usersSummary.map(user => (
          user.userId === selectedTopupUser.userId
            ? { ...user, balance: data.newBalance }
            : user
        ))
      }));
      if (selectedTopupUser.userId === lineUserId) {
        setUserBalance(data.newBalance);
      }
      setSelectedTopupUser(null);
      await showPopup({ icon: 'success', title: '儲值成功', text: `${selectedTopupUser.name} 的餘額已更新。` });
      prefetchAdminSummary(lineUserId);
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
              className="flex items-center gap-0.5 text-xs focus:outline-none hover:scale-110 transition-transform"
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
  const isAdminUser = userRole === 'Admin' || adminSummary.requesterRole === 'Admin';
  const weekendEvents = renderWeekendEvents();

  return (
    <div className="min-h-screen bg-[#F7F5F0] text-gray-800 pb-24">
      <header className="bg-[#2C4A3E] text-white p-4 shadow-md">
        <div className="max-w-xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold">蔬食便當預訂系統</h1>
            <div className="mt-1 text-xs text-emerald-100 flex flex-wrap items-center gap-1.5">
              <span>👤 {name || (identityError ? '未註冊帳號' : '身份驗證中')}</span>
              {name && <span className="bg-emerald-800/80 px-1.5 py-0.5 rounded">{userRole}</span>}
              {defaultFloor && <span className="text-emerald-200">預設領取：{defaultFloor}</span>}
            </div>
            <button
              onClick={fetchBalanceHistory}
              className="text-xs text-emerald-200 hover:underline flex items-center gap-1 mt-0.5 focus:outline-none"
            >
              儲值餘額：
              <span className={`font-bold px-1.5 py-0.5 rounded text-xs ${userBalance < 0 ? 'bg-red-900/80 text-red-200' : 'bg-emerald-900/80 text-yellow-300'}`}>
                ${userBalance}
              </span>
              <span className="text-[10px] bg-emerald-800/80 px-1.5 py-0.5 rounded text-emerald-100">🔍查明細</span>
            </button>
          </div>
          {/* 方案一：依帳戶狀態動態隱藏/顯示管理者專用按鈕 */}
          <div className="flex gap-2">
            {isAdminUser && (
              <>
                {viewMode === 'calendar' && (
                  <button
                    onClick={() => setAdminManageMode(!adminManageMode)}
                    className={`text-xs px-2.5 py-1.5 rounded-lg transition shadow-sm font-bold ${adminManageMode ? 'bg-rose-600 text-white' : 'bg-emerald-800 text-emerald-100'}`}
                  >
                    {adminManageMode ? '🔒 離開管理' : '⚙️ 月曆管理'}
                  </button>
                )}
                {viewMode !== 'admin' && (
                  <button
                    onClick={fetchAdminSummary}
                    className="bg-amber-600 hover:bg-amber-500 text-white text-xs px-3 py-1.5 rounded-lg transition shadow-sm"
                  >
                    📊 總覽
                  </button>
                )}
              </>
            )}
            {viewMode !== 'calendar' && (
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
        {identityError && !loading && (
          <div className="mb-4 text-center text-sm font-bold p-3 rounded-xl bg-amber-50 text-amber-800 border border-amber-200">
            {identityError}
          </div>
        )}

        {loading && (
          <div className="text-center py-8 text-emerald-800 font-medium animate-pulse">
            資料處理中...
          </div>
        )}

        {viewMode === 'calendar' && !loading && (
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-emerald-900/10 space-y-3">
            <div className="flex justify-between items-center px-1">
              <h2 className="text-lg font-bold text-[#2C4A3E]">
                {currentMonth.getFullYear()} 年 {currentMonth.getMonth() + 1} 月 預訂月曆
              </h2>
              <div className="flex gap-1 items-center">
                {isAdminUser && (
                  <button
                    type="button"
                    onClick={handleOpenSpecialAdminModal}
                    className="bg-emerald-700 hover:bg-emerald-600 text-white text-[10px] px-2 py-1.5 rounded-lg transition shadow-sm font-bold"
                  >
                    ＋ 特殊日期開團
                  </button>
                )}
                <button
                  onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
                  className="p-1.5 hover:bg-gray-100 rounded-lg text-sm"
                >
                  ◀
                </button>
                <button
                  onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
                  className="p-1.5 hover:bg-gray-100 rounded-lg text-sm"
                >
                  ▶
                </button>
              </div>
            </div>

            {adminManageMode && (
              <div className="bg-rose-50 border border-rose-200 p-2 rounded-xl text-xs text-rose-800 font-medium flex justify-between items-center">
                <span>🛠️ 管理者模式啟用中：直接點擊日期可手動指定/切換開團店家。</span>
              </div>
            )}

            <div className="grid grid-cols-5 gap-1 text-center font-medium text-xs text-gray-500 mb-1">
              <div>一</div><div>二</div><div>三</div><div>四</div><div>五</div>
            </div>

            <div className="grid grid-cols-5 gap-1.5">
              {renderCalendarDays()}
            </div>

            {weekendEvents.length > 0 && (
              <div className="border-t border-emerald-100 pt-3 space-y-2">
                <h3 className="font-bold text-sm text-[#2C4A3E]">週末特別開團</h3>
                <div className="space-y-2">
                  {weekendEvents}
                </div>
              </div>
            )}
          </div>
        )}

        {viewMode === 'order' && !loading && (
          <div className="space-y-4">
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10 flex justify-between items-center">
              <div>
                <span className="text-xs text-gray-500">預訂日期</span>
                <h2 className="text-lg font-bold text-[#2C4A3E]">{selectedDate} ({setting?.vendor})</h2>
              </div>
              <div className="text-right">
                {isExpired ? (
                  <span className="bg-amber-100 text-amber-800 text-xs px-2.5 py-1 rounded-full font-bold">
                    🔒 已截止 (唯讀)
                  </span>
                ) : (
                  <span className="bg-emerald-100 text-emerald-800 text-xs px-2.5 py-1 rounded-full font-bold">
                    🟢 訂餐中
                  </span>
                )}
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10 space-y-3">
              <h3 className="font-bold text-sm text-[#2C4A3E]">我的訂購設定</h3>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">當日領取樓層</label>
                  <select
                    value={floor}
                    onChange={(e) => setFloor(e.target.value)}
                    disabled={isExpired}
                    className="w-full border rounded-xl px-3 py-2 text-sm bg-white focus:outline-emerald-600 disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                  >
                    <option value="1樓">1樓</option>
                    <option value="9樓">9樓</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1" htmlFor="order-note">備註</label>
                  <input
                    id="order-note"
                    type="text"
                    placeholder="備註 (如：不要菇)"
                    value={orderNote}
                    onChange={(e) => setOrderNote(e.target.value)}
                    disabled={isExpired}
                    className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-emerald-600 disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10 space-y-3">
              <h3 className="font-bold text-sm text-[#2C4A3E]">今日菜單</h3>
              {groupedMenu.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">本日無可選菜單</p>
              ) : (
                groupedMenu.map((group) => (
                  <div key={group.baseName} className="flex gap-3 py-3 border-b last:border-0">
                    {group.imageUrl && !imageLoadErrors[group.baseName] ? (
                      <img
                        src={group.imageUrl}
                        alt={group.baseName}
                        onError={() => setImageLoadErrors(prev => ({ ...prev, [group.baseName]: true }))}
                        className="w-14 h-14 object-cover rounded-xl shadow-sm border border-gray-100 shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 bg-gray-50 rounded-xl flex items-center justify-center border border-gray-100 text-gray-400 text-xs shadow-sm shrink-0">
                        無圖片
                      </div>
                    )}

                    <div className="flex-1 min-w-0 space-y-1">
                      {group.items.map((item) => {
                        const qty = orderItems[item.item_id] || 0;
                        return (
                          <div key={item.item_id} className="flex justify-between items-center gap-2">
                            <div className="min-w-0">
                              <div className="font-bold text-sm text-gray-800 truncate">
                                {item.displayVariant || group.baseName}
                              </div>
                              <div className="text-xs text-emerald-700 font-bold flex items-center gap-1 mt-1">
                                <span className="bg-emerald-50 text-emerald-800 px-1.5 py-0.5 rounded border border-emerald-200 shadow-sm">
                                  ${item.price}
                                </span>
                                {item.note && <span className="text-gray-400 font-normal bg-gray-50 px-1.5 py-0.5 rounded truncate">({item.note})</span>}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                onClick={() => setOrderItems(prev => ({ ...prev, [item.item_id]: Math.max(0, qty - 1) }))}
                                disabled={isExpired}
                                className={`w-7 h-7 rounded-full font-bold transition-all ${isExpired
                                  ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                                  : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                                  }`}
                              >
                                -
                              </button>
                              <span className="w-7 h-7 flex items-center justify-center text-sm font-bold bg-gray-100 rounded-lg text-gray-800 border border-gray-200">
                                {qty}
                              </span>
                              <button
                                onClick={() => setOrderItems(prev => ({ ...prev, [item.item_id]: qty + 1 }))}
                                disabled={isExpired}
                                className={`w-7 h-7 rounded-full font-bold text-white transition-all ${isExpired
                                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                  : 'bg-[#2C4A3E] hover:bg-emerald-800'
                                  }`}
                              >
                                +
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            {isExpired && (
              <div className="text-center text-xs font-bold p-3 rounded-xl bg-amber-50 text-amber-800 border border-amber-200">
                🔒 訂餐已截止或暫停服務
              </div>
            )}

            {message && (
              <div className="text-center text-sm font-bold p-2 rounded-lg bg-emerald-50 text-emerald-800">
                {message}
              </div>
            )}
          </div>
        )}

        {viewMode === 'admin' && !loading && (
          <div className="space-y-4">
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10 space-y-3">
              <h3 className="font-bold text-base text-[#2C4A3E]">👥 成員餘額總表</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="p-2">姓名</th>
                      <th className="p-2">樓層</th>
                      <th className="p-2">餘額</th>
                      <th className="p-2">角色</th>
                      {isAdminUser && <th className="p-2">操作</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {adminSummary.usersSummary.length === 0 ? (
                      <tr>
                        <td colSpan={isAdminUser ? 5 : 4} className="p-4 text-center text-gray-400">查無個人或成員資料</td>
                      </tr>
                    ) : (
                      adminSummary.usersSummary.map((u, idx) => (
                        <tr key={idx} className="border-b last:border-0">
                          <td className="p-2 font-medium">{u.name}</td>
                          <td className="p-2">{u.floor}</td>
                          <td className="p-2">
                            <span className={`font-bold px-1.5 py-0.5 rounded text-xs ${u.balance < 0 ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>
                              ${u.balance}
                            </span>
                          </td>
                          <td className="p-2">{u.role}</td>
                          {isAdminUser && (
                            <td className="p-2">
                              {u.userId ? (
                                <button
                                  type="button"
                                  onClick={() => handleOpenTopupModal(u)}
                                  className="bg-emerald-700 hover:bg-emerald-600 text-white px-2.5 py-1.5 rounded-lg text-xs font-bold transition shadow-sm whitespace-nowrap"
                                >
                                  儲值
                                </button>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10 space-y-3">
              <h3 className="font-bold text-base text-[#2C4A3E]">📦 便購種類匯總</h3>
              {Object.keys(aggregatedOrders).length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">今日無訂單統計</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(aggregatedOrders).map(([itemKey, qty], idx) => (
                    <div key={idx} className="bg-emerald-50/60 border border-emerald-100 p-2.5 rounded-xl flex justify-between items-center">
                      <span className="text-xs font-bold text-emerald-900">{itemKey}</span>
                      <span className="text-xs font-extrabold text-emerald-700 bg-white px-2 py-0.5 rounded-md border border-emerald-200 shadow-sm">
                        x {qty}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white p-4 rounded-2xl shadow-sm border border-emerald-900/10 space-y-3">
              <h3 className="font-bold text-base text-[#2C4A3E]">🍱 當日訂單明細 (依樓層分組)</h3>
              {adminSummary.todayOrders.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">今日無訂單</p>
              ) : (
                <div className="space-y-4">
                  {Object.entries(
                    adminSummary.todayOrders.reduce((acc, order) => {
                      const floor = order.pickup_floor || '其他';
                      if (!acc[floor]) acc[floor] = [];
                      acc[floor].push(order);
                      return acc;
                    }, {})
                  ).map(([floor, orders]) => (
                    <div key={floor} className="space-y-2">
                      <h4 className="text-sm font-bold text-emerald-800 border-b border-emerald-100 pb-1">{floor} 訂單</h4>
                      {orders.map((o, idx) => (
                        <div key={idx} className="flex justify-between items-center text-xs p-3 border border-gray-100 bg-gray-50/80 rounded-xl hover:bg-emerald-50/50 transition-colors">
                          <div>
                            <div className="font-bold text-gray-800">
                              {o.name}
                              {o.note && <span className="ml-2 text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 font-normal shadow-sm">📝 {o.note}</span>}
                            </div>
                            <div className="text-gray-600 mt-1">
                              {o.item_name} <span className="bg-gray-200 px-1.5 py-0.5 rounded font-bold text-gray-700">x {o.quantity}</span>
                            </div>
                          </div>
                          <span className="font-bold bg-emerald-100 text-emerald-800 px-2 py-1 rounded-lg text-xs border border-emerald-200 shadow-sm">
                            ${o.subtotal}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* 底部導覽/操作列 */}
      {viewMode === 'order' && (
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
                    disabled={loading || !activeOrderId}
                    className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl disabled:bg-gray-300 transition active:scale-95 shadow-sm"
                  >
                    取消訂餐
                  </button>
                )}
                <button
                  onClick={handleSubmit}
                  disabled={loading || totalCount === 0}
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

            <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
              {historyLoading ? (
                <p className="text-center text-xs text-gray-400 py-6 animate-pulse">載入明細中...</p>
              ) : historyList.length === 0 ? (
                <p className="text-center text-xs text-gray-400 py-6">尚無交易紀錄</p>
              ) : (
                historyList.map((item, idx) => (
                  <div key={idx} className="bg-gray-50/80 p-3.5 rounded-2xl flex justify-between items-center text-xs border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                    <div>
                      <div className="font-bold text-gray-700 text-sm mb-1">{item.note}</div>
                      <div className="text-[10px] text-gray-400">{item.timestamp}</div>
                    </div>
                    <div className="text-right">
                      <div className={`font-bold text-xs px-2 py-1 rounded-lg inline-block ${item.changeAmount >= 0 ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-rose-100 text-rose-600 border border-rose-200'}`}>
                        {item.changeAmount >= 0 ? `+${item.changeAmount}` : item.changeAmount}
                      </div>
                      <div className="text-[10px] text-gray-500 mt-1.5 font-medium">結餘: ${item.balance}</div>
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

      {selectedTopupUser && isAdminUser && (
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
                目前餘額：<span className="font-bold">${selectedTopupUser.balance}</span>
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
      {selectedAdminDate && (
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

      {showSpecialAdminModal && isAdminUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-opacity">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 space-y-5 shadow-2xl transform transition-all border border-emerald-100">
            <div className="flex justify-between items-center border-b border-gray-100 pb-3">
              <h3 className="font-bold text-base text-[#2C4A3E] flex items-center gap-2">
                <span className="text-xl">📅</span> 特殊日期開團
              </h3>
              <button
                type="button"
                onClick={() => setShowSpecialAdminModal(false)}
                className="text-gray-400 hover:text-rose-500 text-lg font-bold bg-gray-50 hover:bg-rose-50 rounded-full w-8 h-8 flex items-center justify-center transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-gray-600 font-bold mb-2 text-sm" htmlFor="special-admin-date">日期</label>
                <input
                  id="special-admin-date"
                  type="date"
                  value={specialAdminDate}
                  onChange={(e) => setSpecialAdminDate(e.target.value)}
                  className="w-full border border-gray-200 rounded-2xl p-3.5 bg-gray-50 text-sm focus:outline-emerald-600 focus:bg-white transition-colors shadow-sm"
                />
              </div>

              <div>
                <label className="block text-gray-600 font-bold mb-2 text-sm" htmlFor="special-admin-vendor">店家</label>
                <select
                  id="special-admin-vendor"
                  value={specialAdminVendorChoice}
                  onChange={(e) => setSpecialAdminVendorChoice(e.target.value)}
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
                type="button"
                onClick={() => setShowSpecialAdminModal(false)}
                className="w-1/2 bg-gray-100 text-gray-600 py-3 rounded-2xl text-sm font-bold hover:bg-gray-200 transition active:scale-95 shadow-sm"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSpecialAdminSaveVendor}
                disabled={!specialAdminDate || loading}
                className="w-1/2 bg-[#2C4A3E] text-white py-3 rounded-2xl text-sm font-bold hover:bg-emerald-800 disabled:bg-gray-300 transition active:scale-95 shadow-md"
              >
                儲存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
