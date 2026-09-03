const TIMEZONE = "Asia/Taipei";
const USERS_SHEET = "Users";
const ORDERS_SHEET = "Orders";
const BALANCE_LEDGER_SHEET = "TopupHistory";
const VALID_PICKUP_FLOORS = ["1樓", "9樓"];
const UNREGISTERED_USER_MESSAGE = "此 LINE 帳號尚未註冊，請聯絡管理員。";
const LINE_PROFILE_URL = "https://api.line.me/v2/profile";

function identityError(code) {
  return { success: false, code: code, message: code };
}

function safeErrorText(error, sensitiveValues) {
  const rawText = error && error.message ? String(error.message) : String(error || "Unknown error");
  const values = Array.isArray(sensitiveValues) ? sensitiveValues : [sensitiveValues];
  const redactedText = values.reduce((text, value) => {
    const sensitiveValue = String(value || '').trim();
    return sensitiveValue ? text.split(sensitiveValue).join('[REDACTED]') : text;
  }, rawText);
  return redactedText
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/(access[\s_-]?token|id[\s_-]?token|authorization)\s*[:=]?\s*[^\s,;]+/gi, "$1=[REDACTED]");
}

function logIdentityException(code, error, sensitiveValues) {
  const errorType = error && error.name ? String(error.name) : typeof error;
  console.error("[IDENTITY] " + code + " type=" + safeErrorText(errorType, sensitiveValues) + " message=" + safeErrorText(error, sensitiveValues));
}

function isIdentityAction(action) {
  return action === "getUserInfo" || action === "registerUser";
}

function getRegisteredUser(userId) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return null;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName(USERS_SHEET);
  if (!userSheet) return null;

  const data = userSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[0] || '').trim() === normalizedUserId) {
      return {
        rowIndex: i + 1,
        userId: normalizedUserId,
        name: String(row[1] || '').trim(),
        defaultFloor: String(row[2] || '').trim(),
        floor: String(row[2] || '').trim(),
        balance: Number(row[3] || 0),
        role: String(row[4] || 'User').trim() || 'User'
      };
    }
  }

  return null;
}

function getIdentityError(userId) {
  return getRegisteredUser(userId) ? null : UNREGISTERED_USER_MESSAGE;
}

function isValidPickupFloor(floor) {
  return VALID_PICKUP_FLOORS.indexOf(String(floor || '').trim()) >= 0;
}

function isAdminUser(userId) {
  const user = getRegisteredUser(userId);
  return Boolean(user && user.role === 'Admin');
}

function toPublicUser(user) {
  return {
    userId: user.userId,
    name: user.name,
    floor: user.defaultFloor,
    defaultFloor: user.defaultFloor,
    balance: user.balance,
    role: user.role
  };
}

function getLineProfile(accessToken) {
  const normalizedAccessToken = String(accessToken || '').trim();
  if (!normalizedAccessToken) {
    console.warn("[IDENTITY] TOKEN_MISSING");
    return identityError("TOKEN_MISSING");
  }

  let response;
  try {
    response = UrlFetchApp.fetch(LINE_PROFILE_URL, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + normalizedAccessToken },
      muteHttpExceptions: true
    });
  } catch (err) {
    logIdentityException("LINE_PROFILE_NETWORK_OR_AUTH_ERROR", err, normalizedAccessToken);
    return identityError("LINE_PROFILE_NETWORK_OR_AUTH_ERROR");
  }

  let status;
  try {
    status = response.getResponseCode();
  } catch (err) {
    logIdentityException("LINE_PROFILE_NETWORK_OR_AUTH_ERROR", err, normalizedAccessToken);
    return identityError("LINE_PROFILE_NETWORK_OR_AUTH_ERROR");
  }

  if (status !== 200) {
    const statusCode = status === 401
      ? "LINE_PROFILE_401"
      : status === 403
        ? "LINE_PROFILE_403"
        : status === 429
          ? "LINE_PROFILE_429"
          : "LINE_PROFILE_HTTP_" + String(status);
    console.warn("[IDENTITY] " + statusCode + " status=" + String(status));
    return identityError(statusCode);
  }

  let profile;
  try {
    profile = JSON.parse(response.getContentText());
  } catch (err) {
    logIdentityException("PROFILE_RESPONSE_INVALID_JSON", err);
    return identityError("PROFILE_RESPONSE_INVALID_JSON");
  }

  const userId = String(profile && profile.userId || '').trim();
  const displayName = String(profile && profile.displayName || '').trim();
  if (!userId || !displayName) {
    console.warn("[IDENTITY] PROFILE_RESPONSE_INVALID");
    return identityError("PROFILE_RESPONSE_INVALID");
  }

  return {
    success: true,
    userId: userId,
    displayName: displayName
  };
}

function normalizeOrderDate(rawDate) {
  if (rawDate instanceof Date) {
    return Utilities.formatDate(rawDate, TIMEZONE, "yyyy-MM-dd");
  }
  return String(rawDate || '').trim().substring(0, 10);
}

function isValidYearMonth(year, month) {
  const yearText = String(year === undefined || year === null ? '' : year).trim();
  const monthText = String(month === undefined || month === null ? '' : month).trim();
  if (!/^\d{4}$/.test(yearText) || !/^\d{1,2}$/.test(monthText)) return false;

  const yearValue = Number(yearText);
  const monthValue = Number(monthText);
  return isFinite(yearValue)
    && isFinite(monthValue)
    && Math.floor(yearValue) === yearValue
    && Math.floor(monthValue) === monthValue
    && yearValue >= 1900
    && yearValue <= 2100
    && monthValue >= 1
    && monthValue <= 12;
}

function isValidDateString(dateString) {
  const text = String(dateString || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) return false;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

function ledgerTimestampKey(rawTimestamp) {
  if (rawTimestamp instanceof Date) {
    return Utilities.formatDate(rawTimestamp, TIMEZONE, "yyyy-MM-dd HH:mm:ss");
  }

  const text = String(rawTimestamp || '').trim();
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
    const zonedDate = new Date(text);
    if (!isNaN(zonedDate.getTime())) {
      return Utilities.formatDate(zonedDate, TIMEZONE, "yyyy-MM-dd HH:mm:ss");
    }
  }

  const match = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?/);
  if (match) {
    const time = match[2] || '00:00:00';
    return match[1] + ' ' + (time.length === 5 ? time + ':00' : time);
  }

  return '';
}

function hasNumericValue(value) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  return text !== '' && isFinite(Number(text));
}

function doGet(e) {
  const action = e.parameter.action;
  
  if (action === 'getCalendarEvents') {
    const userId = e.parameter.userId;
    return jsonResponse(getCalendarEvents(userId));
  } else if (action === 'getInitData') {
    const targetDate = e.parameter.targetDate;
    return jsonResponse(getInitData(targetDate));
  } else if (action === 'getOrderPageData') {
    const targetDate = e.parameter.targetDate;
    const userId = e.parameter.userId;
    return jsonResponse(getOrderPageData(targetDate, userId));
  } else if (action === 'getOrders') {
    const userId = e.parameter.userId;
    return jsonResponse(getAdminOrders(userId));
  } else if (action === 'getUserOrder') {
    const userId = e.parameter.userId;
    const date = e.parameter.date;
    return jsonResponse(getUserOrder(userId, date));
  } else if (action === 'getUserAllOrdersMap') {
    const userId = e.parameter.userId;
    return jsonResponse(getUserAllOrdersMap(userId));
  } else if (action === 'getUserInfo') {
    return jsonResponse({ success: false, message: "getUserInfo 必須使用 POST 進行 LINE 身份驗證" });
  } else if (action === 'getAdminSummary') {
    return jsonResponse({ success: false, message: "getAdminSummary 必須使用 POST 進行身份驗證" });
  } else if (action === 'getBalanceHistoryByMonth') {
    return jsonResponse({ success: false, message: "getBalanceHistoryByMonth 必須使用 POST 進行身份驗證" });
  } else if (action === 'getBalanceHistory') {
    const userId = e.parameter.userId;
    return jsonResponse(getBalanceHistory(userId));
  }
  
  return jsonResponse({ error: 'Invalid Action' });
}

function doPost(e) {
  let data = null;
  try {
    data = JSON.parse(e.postData.contents);
    const action = data.action;

    if (action === 'submitOrder') {
      return jsonResponse(submitOrder(data));
    } else if (action === 'cancelOrder') {
      return jsonResponse(cancelOrder(data));
    } else if (action === 'getUserInfo') {
      return jsonResponse(getUserInfo(data.accessToken));
    } else if (action === 'registerUser') {
      return jsonResponse(registerUser(data));
    } else if (action === 'getAdminSummary') {
      return jsonResponse(getAdminSummaryForAccessToken(data));
    } else if (action === 'getBalanceHistoryByMonth') {
      return jsonResponse(getBalanceHistoryByMonthForAccessToken(data));
    } else if (action === 'assignProxy') {
      return jsonResponse(assignProxy(data.userId, data.targetUserId, data.newRole));
    } else if (action === 'topUpBalance') {
      return jsonResponse(topUpBalance(data.adminUserId, data.targetUserId, data.amount, data.note));
    } else if (action === 'toggleLike') {
      return jsonResponse(toggleLike(data));
    } else if (action === 'adminSetVendor') {
      return jsonResponse(adminSetVendor(data));
    }
    return jsonResponse(identityError("INVALID_ACTION"));
  } catch (err) {
    const code = data && isIdentityAction(data.action)
      ? "IDENTITY_BACKEND_ERROR"
      : "REQUEST_FAILED";
    const sensitiveValues = data && isIdentityAction(data.action) ? data.accessToken : [];
    logIdentityException(code, err, sensitiveValues);
    return jsonResponse(identityError(code));
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getAdminSummaryForAccessToken(data) {
  try {
    const profile = getLineProfile(data && data.accessToken);
    if (!profile.success) return profile;
    return getAdminSummary(profile.userId, data && data.targetDate);
  } catch (err) {
    return { success: false, message: "目前無法取得管理員訂單總覽" };
  }
}

function getBalanceHistoryByMonthForAccessToken(data) {
  try {
    const profile = getLineProfile(data && data.accessToken);
    if (!profile.success) return profile;
    return getBalanceHistoryByMonth(profile.userId, data && data.year, data && data.month);
  } catch (err) {
    return { success: false, message: "目前無法取得交易明細" };
  }
}

// 簡易農曆初一、十五計算邏輯
function getLunarLabel(year, month, day) {
  // 輕量陰陽曆對照演算法範例，依據公曆計算
  const baseDate = new Date(1900, 0, 31);
  const objDate = new Date(year, month - 1, day);
  let offset = Math.floor((objDate - baseDate) / 86400000);

  const lunarInfo = [
    0x04bd8,0x04ae0,0x0a570,0x054d5,0x0d260,0x0d950,0x16554,0x056a0,0x09ad0,0x055d2,
    0x04ae0,0x0a5b6,0x0a4d0,0x0d250,0x1d255,0x0b540,0x0d6a0,0x0ada2,0x095b0,0x14977,
    0x04970,0x0a4b0,0x0b4b5,0x06a50,0x06d40,0x1ab54,0x02b60,0x09570,0x052f2,0x04970,
    0x06566,0x0d4a0,0x0ea50,0x06e95,0x05ad0,0x02b60,0x186e3,0x092e0,0x1c8d7,0x0c950,
    0x0d4a0,0x1d8a6,0x0b550,0x056a0,0x1a5b4,0x025d0,0x092d0,0x0d2b2,0x0a950,0x0b557,
    0x06ca0,0x0b550,0x15355,0x04da0,0x0a5b0,0x14573,0x052b0,0x0a9a8,0x0e950,0x06aa0,
    0x0aea6,0x0ab50,0x04b60,0x0aae4,0x0a570,0x05260,0x0f263,0x0d950,0x05b57,0x056a0,
    0x096d0,0x04dd5,0x04ad0,0x0a4d0,0x0d4d4,0x0d250,0x0d558,0x0b540,0x0b6a0,0x195a6,
    0x095b0,0x049b0,0x0a974,0x0a4b0,0x0b27a,0x06a50,0x06d40,0x0af46,0x0ab60,0x09570,
    0x04af5,0x04970,0x064b0,0x074a3,0x0ea50,0x06b58,0x055c0,0x0ab60,0x096d5,0x092e0,
    0x0c960,0x0d954,0x0d4a0,0x0da50,0x07552,0x056a0,0x0abb7,0x025d0,0x092d0,0x0cab5,
    0x0a950,0x0b4a0,0x0baa4,0x0ad50,0x055d9,0x04ba0,0x0a5b0,0x05176,0x052b0,0x0a930,
    0x07954,0x06aa0,0x0ad50,0x05b52,0x04b60,0x0a6e6,0x0a4e0,0x0d260,0x0ea65,0x0d530,
    0x05aa0,0x076a3,0x096d0,0x04afb,0x04ad0,0x0a4d0,0x10d80,0x0d250,0x0d520,0x0dd45,
    0x0b5a0,0x056d0,0x055b2,0x049b0,0x0a577,0x0a4b0,0x0aa50,0x1b255,0x06d20,0x0ada0
  ];

  let i, leap = 0, temp = 0;
  for (i = 1900; i < 2100 && offset > 0; i++) {
    temp = lYearDays(i, lunarInfo);
    offset -= temp;
  }
  if (offset < 0) { offset += temp; i--; }

  const lYear = i;
  leap = leapMonth(lYear, lunarInfo);
  let isLeap = false;

  for (i = 1; i < 13 && offset > 0; i++) {
    if (leap > 0 && i == (leap + 1) && !isLeap) {
      --i; isLeap = true; temp = leapDays(lYear, lunarInfo);
    } else {
      temp = monthDays(lYear, i, lunarInfo);
    }
    if (isLeap && i == (leap + 1)) isLeap = false;
    offset -= temp;
  }

  if (offset == 0 && leap > 0 && i == leap + 1) {
    if (isLeap) { isLeap = false; } else { isLeap = true; --i; }
  }
  if (offset < 0) { offset += temp; --i; }

  const lDay = offset + 1;
  if (lDay === 1) return "初一";
  if (lDay === 15) return "十五";
  return null;
}

function lYearDays(y, lunarInfo) {
  let i, sum = 348;
  for (i = 0x8000; i > 0x8; i >>= 1) sum += (lunarInfo[y - 1900] & i) ? 1 : 0;
  return sum + leapDays(y, lunarInfo);
}
function leapDays(y, lunarInfo) {
  if (leapMonth(y, lunarInfo)) return (lunarInfo[y - 1900] & 0x10000) ? 30 : 29;
  else return 0;
}
function leapMonth(y, lunarInfo) { return lunarInfo[y - 1900] & 0xf; }
function monthDays(y, m, lunarInfo) { return (lunarInfo[y - 1900] & (0x10000 >> m)) ? 30 : 29; }

function getDeadlineInfo(orderDateStr, mode) {
  const now = new Date();
  const nowTaipei = new Date(now.toLocaleString("en-US", { timeZone: TIMEZONE }));
  
  const [year, month, day] = orderDateStr.split('-').map(Number);
  let deadline = new Date(year, month - 1, day);

  if (mode === 'A') {
    deadline.setHours(10, 0, 0, 0);
  } else if (mode === 'B') {
    deadline.setDate(deadline.getDate() - 1);
    deadline.setHours(18, 0, 0, 0);
  }

  const isExpired = nowTaipei > deadline;
  return {
    now: nowTaipei.toISOString(),
    deadline: deadline.toISOString(),
    isExpired: isExpired
  };
}

function getCalendarEvents(currentUserId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settingsSheet = ss.getSheetByName('Settings');
  const likesSheet = ss.getSheetByName('Likes');
  
  const settingsData = settingsSheet ? settingsSheet.getDataRange().getValues() : [];
  const likesData = likesSheet ? likesSheet.getDataRange().getValues() : [];

  // 1. 整理 Likes 資料
  const likesCountMap = {};
  const userLikedDates = new Set();

  for (let i = 1; i < likesData.length; i++) {
    const row = likesData[i];
    if (!row[0]) continue;
    const dStr = Utilities.formatDate(new Date(row[0]), TIMEZONE, "yyyy-MM-dd");
    const uId = String(row[1] || '').trim();

    likesCountMap[dStr] = (likesCountMap[dStr] || 0) + 1;
    if (currentUserId && uId === currentUserId) {
      userLikedDates.add(dStr);
    }
  }

  // 2. 整理 Settings 資料
  const events = {};
  const existingSettingsDates = new Set();

  for (let i = 1; i < settingsData.length; i++) {
    const row = settingsData[i];
    if (!row[0]) continue;

    const orderDateStr = Utilities.formatDate(new Date(row[0]), TIMEZONE, "yyyy-MM-dd");
    existingSettingsDates.add(orderDateStr);
    const vendor = row[1];
    let mode = row[2];
    if (!mode) {
      mode = (vendor === '禾拾' || vendor === '合十') ? 'B' : 'A';
    }

    const deadlineInfo = getDeadlineInfo(orderDateStr, mode);
    const [y, m, d] = orderDateStr.split('-').map(Number);

    events[orderDateStr] = {
      order_date: orderDateStr,
      vendor: vendor,
      mode: mode,
      deadline: deadlineInfo.deadline,
      isExpired: deadlineInfo.isExpired,
      likeCount: likesCountMap[orderDateStr] || 0,
      isUserLiked: userLikedDates.has(orderDateStr),
      lunarLabel: getLunarLabel(y, m, d)
    };
  }

  // 3. 補充有愛心但尚未開團的日期
  Object.keys(likesCountMap).forEach(dStr => {
    if (!existingSettingsDates.has(dStr)) {
      const deadlineInfo = getDeadlineInfo(dStr, 'A');
      const [y, m, d] = dStr.split('-').map(Number);
      events[dStr] = {
        order_date: dStr,
        vendor: "", // 未開團
        mode: 'A',
        deadline: deadlineInfo.deadline,
        isExpired: deadlineInfo.isExpired,
        likeCount: likesCountMap[dStr] || 0,
        isUserLiked: userLikedDates.has(dStr),
        lunarLabel: getLunarLabel(y, m, d)
      };
    }
  });

  return { success: true, events: events };
}

// 切換愛心狀態與自動開團/取消
function toggleLike(data) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const dateStr = data.date;
    const userId = data.userId;

    if (!dateStr || !userId) return { success: false, message: "缺少必要參數" };
    if (!getRegisteredUser(userId)) return { success: false, message: UNREGISTERED_USER_MESSAGE };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let likesSheet = ss.getSheetByName('Likes');
    if (!likesSheet) {
      likesSheet = ss.insertSheet('Likes');
      likesSheet.appendRow(['Date', 'LINE_UserID', 'Created_At']);
    }

    const likesData = likesSheet.getDataRange().getValues();
    let userRowIndex = -1;
    let totalLikes = 0;

    for (let i = 1; i < likesData.length; i++) {
      if (!likesData[i][0]) continue;
      const d = Utilities.formatDate(new Date(likesData[i][0]), TIMEZONE, "yyyy-MM-dd");
      const u = String(likesData[i][1] || '').trim();

      if (d === dateStr) {
        totalLikes++;
        if (u === userId) userRowIndex = i + 1;
      }
    }

    let isLikedNow = false;
    if (userRowIndex > 0) {
      // 收回愛心
      likesSheet.deleteRow(userRowIndex);
      totalLikes--;
      isLikedNow = false;
    } else {
      // 點擊愛心
      const nowStr = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm:ss");
      likesSheet.appendRow([dateStr, userId, nowStr]);
      totalLikes++;
      isLikedNow = true;
    }

    // 檢查 Settings 開團邏輯
    let settingsSheet = ss.getSheetByName('Settings');
    if (!settingsSheet) {
      settingsSheet = ss.insertSheet('Settings');
      settingsSheet.appendRow(['Date', 'Vendor', 'Mode']);
    }

    const settingsData = settingsSheet.getDataRange().getValues();
    let settingRowIndex = -1;
    let currentVendor = '';

    for (let i = 1; i < settingsData.length; i++) {
      if (!settingsData[i][0]) continue;
      const d = Utilities.formatDate(new Date(settingsData[i][0]), TIMEZONE, "yyyy-MM-dd");
      if (d === dateStr) {
        settingRowIndex = i + 1;
        currentVendor = settingsData[i][1];
        break;
      }
    }

    // Business rule: 愛心只控制「蔡老師」團；只有目前沒有 vendor 才能自動開「蔡老師」。
    // 既有的禾拾、合十或其他 vendor 不得被愛心機制覆蓋或關閉。
    if (totalLikes > 0 && (!currentVendor || currentVendor === '')) {
      if (settingRowIndex > 0) {
        settingsSheet.getRange(settingRowIndex, 2).setValue('蔡老師');
        settingsSheet.getRange(settingRowIndex, 3).setValue('A');
      } else {
        settingsSheet.appendRow([dateStr, '蔡老師', 'A']);
      }
    } 
    // 愛心歸零且無 ACTIVE 訂單時，只有「蔡老師」團可以由愛心機制自動關閉。
    else if (totalLikes === 0 && currentVendor === '蔡老師') {
      const ordersSheet = ss.getSheetByName('Orders');
      const ordersData = ordersSheet ? ordersSheet.getDataRange().getValues() : [];
      let hasActiveOrders = false;

      for (let i = 1; i < ordersData.length; i++) {
        const rDate = Utilities.formatDate(new Date(ordersData[i][1]), TIMEZONE, "yyyy-MM-dd");
        if (rDate === dateStr && ordersData[i][12] === 'ACTIVE') {
          hasActiveOrders = true;
          break;
        }
      }

      if (!hasActiveOrders && settingRowIndex > 0) {
        settingsSheet.getRange(settingRowIndex, 2).setValue(''); // 清空店家取消開團
      }
    }

    return { success: true, isLiked: isLikedNow, totalLikes: totalLikes };
  } catch (err) {
    return { success: false, message: err.toString() };
  } finally {
    lock.releaseLock();
  }
}

// Admin 手動設定店家
function adminSetVendor(data) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const { adminUserId, dateStr, vendor } = data;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!isAdminUser(adminUserId)) return { success: false, message: "權限不足，僅 Admin 可設定" };

    let settingsSheet = ss.getSheetByName('Settings');
    if (!settingsSheet) {
      settingsSheet = ss.insertSheet('Settings');
      settingsSheet.appendRow(['Date', 'Vendor', 'Mode']);
    }

    const calculatedMode = (vendor === '禾拾' || vendor === '合十') ? 'B' : 'A';

    const settingsData = settingsSheet.getDataRange().getValues();
    let rowIndex = -1;

    for (let i = 1; i < settingsData.length; i++) {
      if (!settingsData[i][0]) continue;
      const d = Utilities.formatDate(new Date(settingsData[i][0]), TIMEZONE, "yyyy-MM-dd");
      if (d === dateStr) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex > 0) {
      settingsSheet.getRange(rowIndex, 2).setValue(vendor || '');
      settingsSheet.getRange(rowIndex, 3).setValue(calculatedMode);
    } else {
      settingsSheet.appendRow([dateStr, vendor || '', calculatedMode]);
    }

    return { success: true, message: "修改成功" };
  } catch (err) {
    return { success: false, message: err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function getInitData(targetDateStr) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settingsSheet = ss.getSheetByName('Settings');
  
  const settingsData = settingsSheet ? settingsSheet.getDataRange().getValues() : [];
  if (settingsData.length < 2) return { success: false, message: "Settings 尚未設定" };

  const effectiveDateStr = targetDateStr || Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");
  let targetRow = null;

  for (let i = 1; i < settingsData.length; i++) {
    const row = settingsData[i];
    if (!row[0]) continue;

    const d = Utilities.formatDate(new Date(row[0]), TIMEZONE, "yyyy-MM-dd");
    if (d === effectiveDateStr) {
      targetRow = row;
      break;
    }
  }

  if (!targetRow || !targetRow[1]) return { success: false, message: "該日期無開團設定" };

  const vendor = targetRow[1];
  const mode = targetRow[2] || ((vendor === '禾拾' || vendor === '合十') ? 'B' : 'A');

  const setting = {
    order_date: Utilities.formatDate(new Date(targetRow[0]), TIMEZONE, "yyyy-MM-dd"),
    vendor: vendor,
    mode: mode
  };

  const deadlineInfo = getDeadlineInfo(setting.order_date, setting.mode);

  const menuSheet = ss.getSheetByName('Menu');
  const menuValues = menuSheet ? menuSheet.getDataRange().getValues() : [];
  let latestMenuDate = null;

  for (let i = 1; i < menuValues.length; i++) {
    const r = menuValues[i];
    if (!r[0]) continue;

    const rVendor = r[1];
    const rDateStr = Utilities.formatDate(new Date(r[0]), TIMEZONE, "yyyy-MM-dd");
    
    if (rVendor === setting.vendor && rDateStr <= setting.order_date) {
      if (!latestMenuDate || rDateStr > latestMenuDate) {
        latestMenuDate = rDateStr;
      }
    }
  }

  const menuItems = [];
  if (latestMenuDate) {
    for (let i = 1; i < menuValues.length; i++) {
      const r = menuValues[i];
      if (!r[0]) continue;

      const rVendor = r[1];
      const rDateStr = Utilities.formatDate(new Date(r[0]), TIMEZONE, "yyyy-MM-dd");
      
      if (rVendor === setting.vendor && rDateStr === latestMenuDate) {
        menuItems.push({
          item_id: r[2],
          item_name: r[3],
          price: Number(r[4]),
          note: r[6],
          image_url: r[7] || ""
        });
      }
    }
  }

  return {
    success: true,
    setting: setting,
    deadline: deadlineInfo,
    menu: menuItems
  };
}

function getOrderPageData(targetDateStr, userId) {
  const myOrder = getUserOrder(userId, targetDateStr);
  if (!myOrder.success) return myOrder;

  const init = getInitData(targetDateStr);
  if (!init.success) return init;

  return {
    success: true,
    setting: init.setting,
    deadline: init.deadline,
    menu: init.menu,
    myOrder: {
      orderId: myOrder.orderId || '',
      items: myOrder.items || [],
      note: myOrder.note || ''
    }
  };
}

function getUserOrder(userId, date) {
  const user = getRegisteredUser(userId);
  if (!user) return { success: false, message: UNREGISTERED_USER_MESSAGE };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ORDERS_SHEET);
  const values = sheet ? sheet.getDataRange().getValues() : [];
  
  const items = [];
  let orderNote = "";
  let orderId = "";

  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const rDate = normalizeOrderDate(r[1]);
    const rowUserId = String(r[13] || '').trim();
    if (rDate === date && rowUserId === user.userId && r[12] === 'ACTIVE') {
      if (!orderId) orderId = String(r[0] || '').trim();
      items.push({
        order_id: String(r[0] || '').trim(),
        item_id: r[5],
        item_name: r[6],
        quantity: Number(r[7]),
        unit_price: Number(r[8]),
        subtotal: Number(r[9])
      });
      if (r[15]) orderNote = r[15]; // 讀取備註
    }
  }

  return { success: true, orderId: orderId, items: items, note: orderNote };
}

function getUserAllOrdersMap(userId) {
  const user = getRegisteredUser(userId);
  if (!user) return { success: false, message: UNREGISTERED_USER_MESSAGE };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ORDERS_SHEET);
  const values = sheet ? sheet.getDataRange().getValues() : [];
  const ordersMap = {};

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (String(row[13] || '').trim() !== user.userId || row[12] !== 'ACTIVE') continue;
    const orderDate = normalizeOrderDate(row[1]);
    if (orderDate) ordersMap[orderDate] = true;
  }

  return { success: true, ordersMap: ordersMap };
}

function getAdminOrders(requestUserId) {
  const requester = getRegisteredUser(requestUserId);
  if (!requester) return { success: false, message: UNREGISTERED_USER_MESSAGE };
  if (requester.role !== 'Admin') {
    return { success: false, message: "權限不足：只有 Admin 可以查看全部訂單" };
  }

  const init = getInitData();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Orders');
  const values = sheet ? sheet.getDataRange().getValues() : [];

  const activeOrders = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const rDate = Utilities.formatDate(new Date(r[1]), TIMEZONE, "yyyy-MM-dd");
    if (rDate === init.setting.order_date && r[12] === 'ACTIVE') {
      activeOrders.push({
        order_id: r[0],
        name: r[3],
        pickup_floor: r[4],
        item_id: r[5],
        item_name: r[6],
        quantity: Number(r[7]),
        unit_price: Number(r[8]),
        subtotal: Number(r[9]),
        created_at: Utilities.formatDate(new Date(r[10]), TIMEZONE, "yyyy-MM-dd HH:mm:ss"),
        note: r[15] || ""
      });
    }
  }

  return {
    success: true,
    setting: init.setting,
    deadline: init.deadline,
    orders: activeOrders
  };
}

function submitOrder(data) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    
    const userId = String(data.userId || '').trim();
    const user = getRegisteredUser(userId);
    if (!user) return { success: false, message: UNREGISTERED_USER_MESSAGE };

    const targetDateStr = String(data.target_date || '').trim();
    const init = getInitData(targetDateStr);
    if (!init.success) return init;
    if (init.deadline.isExpired) {
      return { success: false, message: "訂餐已截止" };
    }

    const floor = String(data.pickup_floor || '').trim();
    const note = String(data.note || '').trim();
    const rawItems = Array.isArray(data.items) ? data.items : [];

    if (!isValidPickupFloor(floor) || rawItems.length === 0) {
      return { success: false, message: "資料填寫不完整" };
    }

    const menuById = {};
    (init.menu || []).forEach(menuItem => {
      menuById[String(menuItem.item_id)] = menuItem;
    });

    const normalizedItems = [];
    const itemIndexById = {};
    for (let i = 0; i < rawItems.length; i++) {
      const rawItem = rawItems[i] || {};
      const itemId = String(rawItem.item_id || '').trim();
      const quantity = Number(rawItem.quantity);
      const menuItem = menuById[itemId];

      if (!menuItem || !isFinite(quantity) || quantity < 0) {
        return { success: false, message: "餐點資料不正確" };
      }
      if (quantity === 0) continue;

      if (itemIndexById[itemId] === undefined) {
        itemIndexById[itemId] = normalizedItems.length;
        normalizedItems.push({
          item_id: itemId,
          item_name: menuItem.item_name,
          quantity: quantity,
          unit_price: Number(menuItem.price) || 0
        });
      } else {
        normalizedItems[itemIndexById[itemId]].quantity += quantity;
      }
    }

    if (normalizedItems.length === 0) {
      return { success: false, message: "請至少選擇一份便購" };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(ORDERS_SHEET);
    if (!sheet) return { success: false, message: "找不到 Orders 資料表" };
    const values = sheet ? sheet.getDataRange().getValues() : [];

    const previousOrders = {};
    for (let i = 1; i < values.length; i++) {
      const rowDateRaw = values[i][1];
      const rowDateStr = normalizeOrderDate(rowDateRaw);
      const rowUserId = String(values[i][13] || '').trim();
      const rowStatus = String(values[i][12] || '').trim();
      const rowOrderId = String(values[i][0] || '').trim();

      if (rowDateStr === targetDateStr && rowUserId === user.userId && rowStatus === 'ACTIVE') {
        if (!rowOrderId) {
          return { success: false, message: "既有訂單缺少 OrderID，無法安全修改" };
        }
        if (!previousOrders[rowOrderId]) {
          previousOrders[rowOrderId] = {
            amount: 0,
            rows: [],
            floor: String(values[i][4] || '').trim()
          };
        }
        previousOrders[rowOrderId].amount += Number(values[i][9]) || 0;
        previousOrders[rowOrderId].rows.push(i + 1);
      }
    }

    const newTotalAmount = normalizedItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
    Object.keys(previousOrders).forEach(orderId => {
      previousOrders[orderId].rows.forEach(rowIndex => {
        sheet.getRange(rowIndex, 13).setValue('CANCELLED');
      });
    });

    let newBalance = user.balance;
    Object.keys(previousOrders).forEach(orderId => {
      const refundAmount = previousOrders[orderId].amount;
      if (refundAmount > 0) {
        newBalance = applyBalanceChange(user.userId, refundAmount, {
          type: 'REFUND',
          referenceId: orderId,
          operatorUserId: user.userId,
          operatorName: user.name,
          floor: previousOrders[orderId].floor,
          note: `修改訂單退款 (${targetDateStr})`
        });
      }
    });

    const orderId = generateOrderId();
    newBalance = applyBalanceChange(user.userId, -newTotalAmount, {
      type: 'ORDER',
      referenceId: orderId,
      operatorUserId: user.userId,
      operatorName: user.name,
      floor: floor,
      note: `訂餐扣款 (${targetDateStr})`
    });

    const nowStr = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm:ss");
    normalizedItems.forEach(item => {
      sheet.appendRow([
        orderId,
        targetDateStr,
        init.setting.vendor,
        user.name,
        floor,
        item.item_id,
        item.item_name,
        item.quantity,
        item.unit_price,
        item.quantity * item.unit_price,
        nowStr,
        nowStr,
        'ACTIVE',
        user.userId,
        newBalance,
        note
      ]);
    });

    return {
      success: true,
      message: "訂單已送出！",
      newBalance: newBalance,
      orderId: orderId
    };
  } catch (err) {
    return { success: false, message: "訂單處理失敗：" + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function generateOrderId() {
  return 'ORD-' + Utilities.getUuid();
}

function cancelOrder(data) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    const userId = String(data.userId || '').trim();
    const user = getRegisteredUser(userId);
    if (!user) return { success: false, message: UNREGISTERED_USER_MESSAGE };

    const orderId = String(data.orderId || '').trim();
    if (!orderId) return { success: false, message: "缺少 OrderID，無法安全取消訂單" };

    const orderDate = String(data.date || '').trim();
    const init = getInitData(orderDate);
    if (!init.success) return init;
    if (init.deadline.isExpired) {
      return { success: false, message: "已過截止時間，無法取消訂購" };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(ORDERS_SHEET);
    const values = sheet ? sheet.getDataRange().getValues() : [];
    let cancelled = false;
    let totalRefund = 0;
    let refundFloor = '';

    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      if (
        String(row[0] || '').trim() === orderId
        && normalizeOrderDate(row[1]) === orderDate
        && String(row[13] || '').trim() === user.userId
        && row[12] === 'ACTIVE'
      ) {
        totalRefund += Number(row[9]) || 0;
        refundFloor = String(row[4] || '').trim();
        sheet.getRange(i + 1, 13).setValue('CANCELLED');
        cancelled = true;
      }
    }

    if (!cancelled) {
      return { success: false, message: "查無屬於目前使用者的可取消訂單" };
    }

    const newBalance = applyBalanceChange(user.userId, totalRefund, {
      type: 'REFUND',
      referenceId: orderId,
      operatorUserId: user.userId,
      operatorName: user.name,
      floor: refundFloor,
      note: `取消訂單退款 (${orderDate})`
    });

    return {
      success: true,
      message: "訂單已取消並已退款",
      newBalance: newBalance
    };
  } catch (err) {
    return { success: false, message: "取消失敗：" + err.toString() };
  } finally {
    lock.releaseLock();
  }
}

function getUserCurrentBalance(userId) {
  const user = getRegisteredUser(userId);
  return user ? user.balance : null;
}

function applyBalanceChange(userId, amount, ledgerMeta) {
  const user = getRegisteredUser(userId);
  if (!user) throw new Error(UNREGISTERED_USER_MESSAGE);

  const numericAmount = Number(amount);
  if (!isFinite(numericAmount)) throw new Error("餘額異動金額不正確");

  const previousBalance = user.balance;
  const newBalance = previousBalance + numericAmount;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName(USERS_SHEET);
  userSheet.getRange(user.rowIndex, 4).setValue(newBalance);
  appendBalanceLedger(user, numericAmount, newBalance, ledgerMeta);
  return newBalance;
}

function ensureTopupHistorySchema() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let historySheet = ss.getSheetByName(BALANCE_LEDGER_SHEET);
  if (!historySheet) {
    historySheet = ss.insertSheet(BALANCE_LEDGER_SHEET);
    historySheet.getRange(1, 1, 1, 7).setValues([[
      "Timestamp", "LINE_UserID", "姓名", "樓層", "異動金額", "結餘", "備註"
    ]]);
  } else if (!historySheet.getRange(1, 1).getValue()) {
    historySheet.getRange(1, 1, 1, 7).setValues([[
      "Timestamp", "LINE_UserID", "姓名", "樓層", "異動金額", "結餘", "備註"
    ]]);
  }

  const headers = ["TransactionID", "Type", "ReferenceID", "OperatorUserID", "OperatorName"];
  const headerValues = historySheet.getRange(1, 8, 1, 5).getValues()[0];
  for (let i = 0; i < headers.length; i++) {
    if (!headerValues[i]) historySheet.getRange(1, 8 + i).setValue(headers[i]);
  }

  const lastRow = historySheet.getLastRow();
  if (lastRow > 1) {
    const metadataRange = historySheet.getRange(2, 8, lastRow - 1, 5);
    const metadata = metadataRange.getValues();
    const notes = historySheet.getRange(2, 7, lastRow - 1, 1).getValues();
    let changed = false;

    for (let i = 0; i < metadata.length; i++) {
      if (!metadata[i][0]) {
        metadata[i][0] = 'TXN-LEGACY-' + Utilities.getUuid();
        changed = true;
      }
      if (!metadata[i][1]) {
        metadata[i][1] = inferLegacyLedgerType(notes[i][0]);
        changed = true;
      }
      if (!metadata[i][3]) {
        metadata[i][3] = 'LEGACY';
        changed = true;
      }
      if (!metadata[i][4]) {
        metadata[i][4] = 'LEGACY';
        changed = true;
      }
    }

    if (changed) metadataRange.setValues(metadata);
  }

  return historySheet;
}

function inferLegacyLedgerType(note) {
  const text = String(note || '').trim();
  if (text.indexOf('Admin 手動儲值') === 0) return 'TOPUP';
  if (text.indexOf('訂餐扣款') === 0) return 'ORDER';
  if (text.indexOf('取消訂單退款') === 0) return 'REFUND';
  return '';
}

function appendBalanceLedger(user, amount, newBalance, ledgerMeta) {
  const validTypes = ['TOPUP', 'ORDER', 'REFUND', 'ADJUSTMENT'];
  if (validTypes.indexOf(ledgerMeta.type) < 0) throw new Error("Ledger Type 不正確");

  const historySheet = ensureTopupHistorySchema();
  const nowStr = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm:ss");
  historySheet.appendRow([
    nowStr,
    user.userId,
    user.name,
    ledgerMeta.floor || user.defaultFloor,
    amount,
    newBalance,
    ledgerMeta.note || '',
    'TXN-' + Utilities.getUuid(),
    ledgerMeta.type,
    ledgerMeta.referenceId || '',
    ledgerMeta.operatorUserId || '',
    ledgerMeta.operatorName || ''
  ]);
}

function getBalanceHistory(userId) {
  const user = getRegisteredUser(userId);
  if (!user) return { success: false, message: UNREGISTERED_USER_MESSAGE };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const historySheet = ss.getSheetByName(BALANCE_LEDGER_SHEET);
  if (!historySheet) return { success: true, history: [] };

  const values = historySheet.getDataRange().getValues().slice(1);
  const userHistory = [];

  for (let i = values.length - 1; i >= 0; i--) {
    const r = values[i];
    if (String(r[1] || '').trim() === user.userId) {
      userHistory.push({
        timestamp: Utilities.formatDate(new Date(r[0]), TIMEZONE, "yyyy-MM-dd HH:mm"),
        changeAmount: Number(r[4]),
        balance: Number(r[5]),
        note: r[6] || "",
        transactionId: r[7] || "",
        type: r[8] || "",
        referenceId: r[9] || ""
      });
    }
  }

  return { success: true, history: userHistory };
}

function getBalanceHistoryByMonth(userId, year, month) {
  const user = getRegisteredUser(userId);
  if (!user) return { success: false, message: UNREGISTERED_USER_MESSAGE };
  if (!isValidYearMonth(year, month)) {
    return { success: false, message: "查詢月份不正確" };
  }

  const yearValue = Number(year);
  const monthValue = Number(month);
  const monthKey = yearValue + '-' + String(monthValue).padStart(2, '0');
  const historySheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BALANCE_LEDGER_SHEET);
  const values = historySheet ? historySheet.getDataRange().getValues().slice(1) : [];
  const userRows = [];
  let hasUserLedgerRows = false;

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    if (String(row[1] || '').trim() !== user.userId) continue;
    hasUserLedgerRows = true;

    const timestampKey = ledgerTimestampKey(row[0]);
    const hasAmount = hasNumericValue(row[4]);
    const hasBalance = hasNumericValue(row[5]);
    if (!timestampKey || (!hasAmount && !hasBalance)) continue;

    userRows.push({
      rowIndex: i,
      timestampKey: timestampKey,
      amount: hasAmount ? Number(row[4]) : null,
      balanceAfter: hasBalance ? Number(row[5]) : null,
      row: row
    });
  }

  userRows.sort((a, b) => a.timestampKey.localeCompare(b.timestampKey) || a.rowIndex - b.rowIndex);
  const monthRows = userRows.filter(item => item.amount !== null && item.timestampKey.substring(0, 7) === monthKey);
  const priorRows = userRows.filter(item => item.timestampKey.substring(0, 7) < monthKey);
  const priorWithBalance = priorRows.filter(item => item.balanceAfter !== null);
  const monthStartBalance = priorWithBalance.length > 0
    ? priorWithBalance[priorWithBalance.length - 1].balanceAfter
    : null;

  let openingBalance = monthStartBalance;
  if (openingBalance === null && monthRows.length > 0 && monthRows[0].balanceAfter !== null) {
    openingBalance = monthRows[0].balanceAfter - monthRows[0].amount;
  }
  if (openingBalance === null && !hasUserLedgerRows) {
    openingBalance = user.balance;
  }
  if (openingBalance === null) {
    return { success: false, message: "目前無法重建此月份的餘額明細" };
  }

  let totalCredit = 0;
  let totalDebit = 0;
  monthRows.forEach(item => {
    if (item.amount >= 0) {
      totalCredit += item.amount;
    } else {
      totalDebit += Math.abs(item.amount);
    }
  });

  const lastMonthRow = monthRows[monthRows.length - 1];
  const closingBalance = lastMonthRow && lastMonthRow.balanceAfter !== null
    ? lastMonthRow.balanceAfter
    : openingBalance + totalCredit - totalDebit;

  const transactions = monthRows.slice().reverse().map(item => {
    const row = item.row;
    const occurredAt = item.timestampKey.substring(0, 16);
    return {
      id: row[7] || '',
      transactionId: row[7] || '',
      type: row[8] || '',
      referenceId: row[9] || '',
      description: row[6] || '',
      note: row[6] || '',
      occurredAt: occurredAt,
      timestamp: occurredAt,
      amount: item.amount,
      changeAmount: item.amount,
      balanceAfter: item.balanceAfter,
      balance: item.balanceAfter
    };
  });

  return {
    success: true,
    ok: true,
    year: yearValue,
    month: monthValue,
    openingBalance: openingBalance,
    totalCredit: totalCredit,
    totalDebit: totalDebit,
    closingBalance: closingBalance,
    transactions: transactions
  };
}

function getUserInfo(accessToken) {
  const profile = getLineProfile(accessToken);
  if (!profile.success) return profile;

  let user;
  try {
    user = getRegisteredUser(profile.userId);
  } catch (err) {
    logIdentityException("USER_LOOKUP_FAILED", err);
    return identityError("USER_LOOKUP_FAILED");
  }
  if (!user) {
    return {
      success: true,
      registered: false,
      lineUserId: profile.userId,
      displayName: profile.displayName
    };
  }

  return {
    success: true,
    registered: true,
    user: toPublicUser(user)
  };
}

function registerUser(data) {
  const profile = getLineProfile(data && data.accessToken);
  if (!profile.success) return profile;

  const pickupFloor = String(data && data.pickupFloor || '').trim();
  if (!isValidPickupFloor(pickupFloor)) {
    return { success: false, message: "預設領取樓層只允許 1樓 或 9樓" };
  }

  const lock = LockService.getScriptLock();
  let lockAcquired = false;
  try {
    lock.waitLock(10000);
    lockAcquired = true;

    const existingUser = getRegisteredUser(profile.userId);
    if (existingUser) {
      return {
        success: true,
        registered: true,
        alreadyRegistered: true,
        user: toPublicUser(existingUser)
      };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const userSheet = ss.getSheetByName(USERS_SHEET);
    if (!userSheet) {
      return { success: false, message: "找不到 Users 資料表，無法完成註冊" };
    }

    // 身份與姓名只使用 LINE Profile API 回傳值；不讀取 client userId/displayName。
    // 先將姓名欄設為純文字，避免 LINE displayName 被 Sheets 當成公式執行。
    const nextUserRow = userSheet.getLastRow() + 1;
    userSheet.getRange(nextUserRow, 2).setNumberFormat('@');
    userSheet.getRange(nextUserRow, 1, 1, 5).setValues([[
      profile.userId,
      profile.displayName,
      pickupFloor,
      0,
      'User'
    ]]);

    // 寫入後只讀回一次；失敗時直接回錯誤，不再次 append，避免重複資料。
    const canonicalUser = getRegisteredUser(profile.userId);
    if (!canonicalUser) {
      return { success: false, message: "註冊資料寫入後無法重新取得使用者資料，請聯絡管理員" };
    }

    return {
      success: true,
      registered: true,
      user: toPublicUser(canonicalUser)
    };
  } catch (err) {
    logIdentityException("REGISTRATION_BACKEND_ERROR", err, data && data.accessToken);
    return identityError("REGISTRATION_BACKEND_ERROR");
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

function auditBalanceConsistency() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName(USERS_SHEET);
  const historySheet = ss.getSheetByName(BALANCE_LEDGER_SHEET);
  if (!userSheet) return { success: false, message: "尚未建立 Users 資料" };

  const userRows = userSheet.getDataRange().getValues().slice(1);
  const ledgerRows = historySheet ? historySheet.getDataRange().getValues().slice(1) : [];
  const latestLedgerByUser = {};

  ledgerRows.forEach(row => {
    const userId = String(row[1] || '').trim();
    const ledgerBalance = Number(row[5]);
    if (userId && isFinite(ledgerBalance)) {
      latestLedgerByUser[userId] = ledgerBalance;
    }
  });

  const results = userRows.map(row => {
    const userId = String(row[0] || '').trim();
    const usersBalance = Number(row[3] || 0);
    const hasLedgerBalance = Object.prototype.hasOwnProperty.call(latestLedgerByUser, userId);
    const latestLedgerBalance = hasLedgerBalance ? latestLedgerByUser[userId] : null;
    const difference = hasLedgerBalance ? usersBalance - latestLedgerBalance : null;
    return {
      lineUserId: userId,
      name: row[1] || '',
      usersBalance: usersBalance,
      latestLedgerBalance: latestLedgerBalance,
      difference: difference,
      isConsistent: hasLedgerBalance && difference === 0
    };
  });

  return {
    success: true,
    allConsistent: results.every(result => result.isConsistent),
    results: results
  };
}
function getAdminSummary(requestUserId, targetDateStr) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName(USERS_SHEET);
  const orderSheet = ss.getSheetByName(ORDERS_SHEET);
  
  if (!userSheet) return { success: false, message: "尚未建立 Users 資料" };

  const requester = getRegisteredUser(requestUserId);
  if (!requester) return { success: false, message: UNREGISTERED_USER_MESSAGE };
  if (requester.role !== "Admin") {
    return { success: false, message: "權限不足：只有 Admin 可以查看訂單總覽" };
  }

  const userData = userSheet.getDataRange().getValues().slice(1);
  const allUsers = userData.map(row => ({
    userId: row[0],
    name: row[1],
    floor: row[2],
    balance: Number(row[3] || 0),
    role: row[4] || "User"
  }));

  const isRequesterAdmin = requester.role === "Admin";
  const visibleUsers = isRequesterAdmin ? allUsers : (requester ? [requester] : []);

  const todayStr = targetDateStr === undefined || targetDateStr === null || String(targetDateStr).trim() === ''
    ? Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd")
    : String(targetDateStr).trim();
  if (!isValidDateString(todayStr)) {
    return { success: false, message: "日期格式不正確" };
  }

  const orderValues = orderSheet ? orderSheet.getDataRange().getValues().slice(1) : [];
  
  const todayOrders = [];
  const itemSummary = {};
  const pickupSummary = {};
  let totalItems = 0;
  let totalAmount = 0;
  for (let i = 0; i < orderValues.length; i++) {
    const r = orderValues[i];
    const rDate = normalizeOrderDate(r[1]);
    if (rDate === todayStr && r[12] === 'ACTIVE') {
      const quantity = Number(r[7] || 0);
      const subtotal = Number(r[9] || 0);
      const itemKey = String(r[5] || r[6] || '');
      const pickupFloor = String(r[4] || '其他');
      totalItems += quantity;
      totalAmount += subtotal;

      if (!itemSummary[itemKey]) {
        itemSummary[itemKey] = {
          item_id: r[5] || '',
          item_name: r[6] || '',
          quantity: 0,
          totalAmount: 0
        };
      }
      itemSummary[itemKey].quantity += quantity;
      itemSummary[itemKey].totalAmount += subtotal;

      if (!pickupSummary[pickupFloor]) {
        pickupSummary[pickupFloor] = { totalItems: 0, totalAmount: 0 };
      }
      pickupSummary[pickupFloor].totalItems += quantity;
      pickupSummary[pickupFloor].totalAmount += subtotal;

      todayOrders.push({
        order_id: r[0],
        name: r[3],
        pickup_floor: r[4],
        item_id: r[5],
        item_name: r[6],
        quantity: Number(r[7]),
        unit_price: Number(r[8]),
        subtotal: Number(r[9]),
        created_at: Utilities.formatDate(new Date(r[10]), TIMEZONE, "yyyy-MM-dd HH:mm:ss"),
        note: r[15] || ""
      });
    }
  }

  return {
    success: true,
    targetDate: todayStr,
    requesterRole: requester ? requester.role : "User",
    usersSummary: visibleUsers,
    todayOrders: todayOrders,
    totalItems: totalItems,
    totalAmount: totalAmount,
    items: Object.keys(itemSummary).map(key => itemSummary[key]),
    pickupSummary: pickupSummary
  };
}

function assignProxy(adminUserId, targetUserId, newRole) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName("Users");
  if (!userSheet) return { success: false, message: "找不到 Users 資料表" };

  const userData = userSheet.getDataRange().getValues();
  if (!isAdminUser(adminUserId)) return { success: false, message: "只有最高管理者 (Admin) 可以指定代理人" };

  for (let i = 1; i < userData.length; i++) {
    if (userData[i][0] === targetUserId) {
      userSheet.getRange(i + 1, 5).setValue(newRole);
      return { success: true, message: "已更新角色為 " + newRole };
    }
  }

  return { success: false, message: "找不到目標使用者" };
}

function topUpBalance(adminUserId, targetUserId, amount, note) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    const operator = getRegisteredUser(adminUserId);
    if (!operator) return { success: false, message: UNREGISTERED_USER_MESSAGE };
    if (operator.role !== 'Admin') {
      return { success: false, message: "權限不足：只有最高管理者 (Admin) 可以進行人工儲值" };
    }

    const targetUser = getRegisteredUser(targetUserId);
    if (!targetUser) return { success: false, message: UNREGISTERED_USER_MESSAGE };

    const amountText = String(amount === undefined || amount === null ? '' : amount).trim();
    const topUpVal = Number(amountText);
    if (!amountText || !isFinite(topUpVal) || topUpVal <= 0) {
      return { success: false, message: "儲值金額必須大於 0" };
    }

    const newBalance = applyBalanceChange(targetUser.userId, topUpVal, {
      type: 'TOPUP',
      referenceId: '',
      operatorUserId: operator.userId,
      operatorName: operator.name,
      note: String(note || '').trim() || "Admin 手動儲值"
    });

    return {
      success: true,
      message: "儲值成功！",
      newBalance: newBalance,
      targetUserId: targetUser.userId
    };
  } catch (err) {
    return { success: false, message: "儲值失敗：" + err.toString() };
  } finally {
    lock.releaseLock();
  }
}
