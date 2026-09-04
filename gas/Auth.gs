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

function getAuthenticatedUser(accessToken) {
  const profile = getLineProfile(accessToken);
  if (!profile.success) return profile;

  const user = getRegisteredUser(profile.userId);
  if (!user) return { success: false, message: UNREGISTERED_USER_MESSAGE };

  return { success: true, user: user };
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

