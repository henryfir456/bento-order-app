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
  if (!hasPermission(requester.role, 'viewAllOrders')) {
    return { success: false, message: "權限不足：目前角色無法查看全部訂單" };
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

