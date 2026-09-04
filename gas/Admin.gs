function getAdminSummary(requestUserId, targetDateStr, includeMemberBalances) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName(USERS_SHEET);
  const orderSheet = ss.getSheetByName(ORDERS_SHEET);
  
  if (!userSheet) return { success: false, message: "尚未建立 Users 資料" };

  const requester = getRegisteredUser(requestUserId);
  if (!requester) return { success: false, message: UNREGISTERED_USER_MESSAGE };
  if (!hasPermission(requester.role, 'viewAdminOrderSummary')) {
    return { success: false, message: "權限不足：目前角色無法查看訂單總覽" };
  }

  const shouldIncludeMemberBalances = includeMemberBalances === undefined || includeMemberBalances === null
    ? true
    : includeMemberBalances === true || String(includeMemberBalances).toLowerCase() === 'true';
  const visibleUsers = shouldIncludeMemberBalances && hasPermission(requester.role, 'viewMemberBalances')
    ? getAllUserSummaries(userSheet)
    : [];

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

