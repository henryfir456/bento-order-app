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

  return {
    success: true,
    events: events,
    announcement: getLatestAnnouncement()
  };
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
    const operator = getRegisteredUser(adminUserId);
    if (!operator || !hasPermission(operator.role, 'manageCalendar')) {
      return { success: false, message: "權限不足，僅具備月曆管理權限的管理員可設定" };
    }

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
