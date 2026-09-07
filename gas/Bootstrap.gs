function getBootstrapData(accessToken, targetDateStr, bootId, deferUiDataFlag) {
  const deferUiData = deferUiDataFlag === true;
  const resolvedBootId = resolveBootId(bootId);
  const totalStart = Date.now();
  let lineProfileMs = null;
  let userLookupMs = null;
  let settingsMs = null;
  let likesMs = null;
  let announcementsMs = null;
  let ordersMs = null;
  let calendarMs = null;
  let bootstrapStatus = 'error';
  const timingSummary = {
    status: 'error',
    metrics: {}
  };

  const recordTiming = (metric, elapsedMs) => {
    if (!BOOTSTRAP_METRICS[metric]) return;
    timingSummary.metrics[metric] = Math.max(0, Math.round(Number(elapsedMs) || 0));
  };

  const finish = (result, status) => {
    bootstrapStatus = BOOTSTRAP_STATUSES[status] ? status : 'error';
    timingSummary.status = bootstrapStatus;
    return Object.assign({}, result, {
      bootId: resolvedBootId,
      observability: {
        timing: timingSummary
      }
    });
  };

  try {
    const profileStart = Date.now();
    const profile = getLineProfile(accessToken);
    lineProfileMs = Date.now() - profileStart;
    if (!profile.success) return finish(profile, 'error');

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const usersSheet = ss.getSheetByName(USERS_SHEET);
    const usersStart = Date.now();
    const usersData = usersSheet ? usersSheet.getDataRange().getValues() : [];
    const user = getRegisteredUser(profile.userId, usersData);
    userLookupMs = Date.now() - usersStart;

    if (!user) {
      return finish({
        success: true,
        registered: false,
        lineUserId: profile.userId,
        displayName: profile.displayName
      }, 'success');
    }

    const settingsSheet = ss.getSheetByName('Settings');
    const likesSheet = deferUiData ? null : ss.getSheetByName('Likes');
    const ordersSheet = ss.getSheetByName(ORDERS_SHEET);
    let likesData = [];
    let announcements = [];

    const settingsStart = Date.now();
    const settingsData = settingsSheet ? settingsSheet.getDataRange().getValues() : [];
    settingsMs = Date.now() - settingsStart;

    if (!deferUiData) {
      const likesStart = Date.now();
      likesData = likesSheet ? likesSheet.getDataRange().getValues() : [];
      likesMs = Date.now() - likesStart;

      const announcementsStart = Date.now();
      announcements = getActiveAnnouncements(ss);
      announcementsMs = Date.now() - announcementsStart;
    }

    const ordersStart = Date.now();
    const orderValues = ordersSheet ? ordersSheet.getDataRange().getValues() : [];
    const ordersMap = getUserAllOrdersMap(user.userId, user, orderValues);
    ordersMs = Date.now() - ordersStart;
    if (!ordersMap.success) return finish(ordersMap, 'error');

    const calendarStart = Date.now();
    const calendar = getCalendarEvents(user.userId, deferUiData
      ? {
        settingsData: settingsData,
        skipLikes: true,
        skipAnnouncements: true
      }
      : {
        settingsData: settingsData,
        likesData: likesData,
        announcements: announcements
      });
    calendarMs = Date.now() - calendarStart;
    if (!calendar.success) return finish(calendar, 'error');

    return finish({
      success: true,
      registered: true,
      user: Object.assign({}, toPublicUser(user), {
        lineUserId: profile.userId,
        displayName: profile.displayName
      }),
      calendar: {
        events: calendar.events,
        announcements: calendar.announcements,
        announcement: calendar.announcement
      },
      ordersMap: ordersMap.ordersMap,
      targetDate: String(targetDateStr || '').trim() || null
    }, 'success');
  } finally {
    if (lineProfileMs !== null) recordTiming('LINE_PROFILE_MS', lineProfileMs);
    if (userLookupMs !== null) recordTiming('USER_LOOKUP_MS', userLookupMs);
    if (settingsMs !== null) recordTiming('SETTINGS_MS', settingsMs);
    if (likesMs !== null) recordTiming('LIKES_MS', likesMs);
    if (announcementsMs !== null) recordTiming('ANNOUNCEMENTS_MS', announcementsMs);
    if (ordersMs !== null) recordTiming('ORDERS_MS', ordersMs);
    if (calendarMs !== null) recordTiming('CALENDAR_MS', calendarMs);
    const totalMs = Date.now() - totalStart;
    recordTiming('BOOTSTRAP_TOTAL_MS', totalMs);
    logBootstrapTiming(resolvedBootId, 'LINE_PROFILE_MS', lineProfileMs, bootstrapStatus);
    logBootstrapTiming(resolvedBootId, 'USER_LOOKUP_MS', userLookupMs, bootstrapStatus);
    logBootstrapTiming(resolvedBootId, 'SETTINGS_MS', settingsMs, bootstrapStatus);
    if (likesMs !== null) logBootstrapTiming(resolvedBootId, 'LIKES_MS', likesMs, bootstrapStatus);
    if (announcementsMs !== null) logBootstrapTiming(resolvedBootId, 'ANNOUNCEMENTS_MS', announcementsMs, bootstrapStatus);
    logBootstrapTiming(resolvedBootId, 'ORDERS_MS', ordersMs, bootstrapStatus);
    logBootstrapTiming(resolvedBootId, 'CALENDAR_MS', calendarMs, bootstrapStatus);
    logBootstrapTiming(resolvedBootId, 'BOOTSTRAP_TOTAL_MS', totalMs, bootstrapStatus);
  }
}
