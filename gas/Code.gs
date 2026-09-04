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
      return jsonResponse(submitOrderForAccessToken(data));
    } else if (action === 'cancelOrder') {
      return jsonResponse(cancelOrderForAccessToken(data));
    } else if (action === 'getUserInfo') {
      return jsonResponse(getUserInfo(data.accessToken));
    } else if (action === 'registerUser') {
      return jsonResponse(registerUser(data));
    } else if (action === 'getAdminSummary') {
      return jsonResponse(getAdminSummaryForAccessToken(data));
    } else if (action === 'getBalanceHistoryByMonth') {
      return jsonResponse(getBalanceHistoryByMonthForAccessToken(data));
    } else if (action === 'assignProxy') {
      return jsonResponse(assignProxyForAccessToken(data));
    } else if (action === 'topUpBalance') {
      return jsonResponse(topUpBalanceForAccessToken(data));
    } else if (action === 'toggleLike') {
      return jsonResponse(toggleLikeForAccessToken(data));
    } else if (action === 'adminSetVendor') {
      return jsonResponse(adminSetVendorForAccessToken(data));
    } else if (action === 'getMemberBalances') {
      return jsonResponse(getMemberBalancesForAccessToken(data));
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

function submitOrderForAccessToken(data) {
  const authenticated = getAuthenticatedUser(data && data.accessToken);
  if (!authenticated.success) return authenticated;
  return submitOrder(Object.assign({}, data, { userId: authenticated.user.userId }));
}

function cancelOrderForAccessToken(data) {
  const authenticated = getAuthenticatedUser(data && data.accessToken);
  if (!authenticated.success) return authenticated;
  return cancelOrder(Object.assign({}, data, { userId: authenticated.user.userId }));
}

function toggleLikeForAccessToken(data) {
  const authenticated = getAuthenticatedUser(data && data.accessToken);
  if (!authenticated.success) return authenticated;
  return toggleLike(Object.assign({}, data, { userId: authenticated.user.userId }));
}

function adminSetVendorForAccessToken(data) {
  const authenticated = getAuthenticatedUser(data && data.accessToken);
  if (!authenticated.success) return authenticated;
  return adminSetVendor(Object.assign({}, data, { adminUserId: authenticated.user.userId }));
}

function assignProxyForAccessToken(data) {
  const authenticated = getAuthenticatedUser(data && data.accessToken);
  if (!authenticated.success) return authenticated;
  return assignProxy(authenticated.user.userId, data && data.targetUserId, data && data.newRole);
}

function topUpBalanceForAccessToken(data) {
  const authenticated = getAuthenticatedUser(data && data.accessToken);
  if (!authenticated.success) return authenticated;
  return topUpBalance(authenticated.user.userId, data && data.targetUserId, data && data.amount, data && data.note);
}

function getAdminSummaryForAccessToken(data) {
  try {
    const authenticated = getAuthenticatedUser(data && data.accessToken);
    if (!authenticated.success) return authenticated;
    return getAdminSummary(authenticated.user.userId, data && data.targetDate, data && data.includeMemberBalances);
  } catch (err) {
    return { success: false, message: "目前無法取得管理員訂單總覽" };
  }
}

function getBalanceHistoryByMonthForAccessToken(data) {
  try {
    const authenticated = getAuthenticatedUser(data && data.accessToken);
    if (!authenticated.success) return authenticated;
    return getBalanceHistoryByMonth(authenticated.user.userId, data && data.year, data && data.month);
  } catch (err) {
    return { success: false, message: "目前無法取得交易明細" };
  }
}

function getMemberBalancesForAccessToken(data) {
  try {
    const authenticated = getAuthenticatedUser(data && data.accessToken);
    if (!authenticated.success) return authenticated;
    return getMemberBalances(authenticated.user.userId);
  } catch (err) {
    return { success: false, message: "目前無法取得成員餘額" };
  }
}

// 簡易農曆初一、十五計算邏輯

