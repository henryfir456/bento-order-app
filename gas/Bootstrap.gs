function getBootstrapData(accessToken, targetDateStr, bootId) {
  const resolvedBootId = resolveBootId(bootId);
  const totalStart = Date.now();
  let lineProfileMs = 0;
  let userLookupMs = 0;
  let settingsMs = 0;
  let likesMs = 0;
  let announcementsMs = 0;
  let ordersMs = 0;
  let calendarMs = 0;
  let bootstrapStatus = 'error';

  const finish = (result, status) => {
    bootstrapStatus = status;
    return Object.assign({}, result, { bootId: resolvedBootId });
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
    const likesSheet = ss.getSheetByName('Likes');
    const ordersSheet = ss.getSheetByName(ORDERS_SHEET);

    const settingsStart = Date.now();
    const settingsData = settingsSheet ? settingsSheet.getDataRange().getValues() : [];
    settingsMs = Date.now() - settingsStart;

    const likesStart = Date.now();
    const likesData = likesSheet ? likesSheet.getDataRange().getValues() : [];
    likesMs = Date.now() - likesStart;

    const announcementsStart = Date.now();
    const announcements = getActiveAnnouncements();
    announcementsMs = Date.now() - announcementsStart;

    const ordersStart = Date.now();
    const orderValues = ordersSheet ? ordersSheet.getDataRange().getValues() : [];
    const ordersMap = getUserAllOrdersMap(user.userId, user, orderValues);
    ordersMs = Date.now() - ordersStart;
    if (!ordersMap.success) return finish(ordersMap, 'error');

    const calendarStart = Date.now();
    const calendar = getCalendarEvents(user.userId, {
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
    logBootstrapTiming(resolvedBootId, 'LINE_PROFILE_MS', lineProfileMs, bootstrapStatus);
    logBootstrapTiming(resolvedBootId, 'USER_LOOKUP_MS', userLookupMs, bootstrapStatus);
    logBootstrapTiming(resolvedBootId, 'SETTINGS_MS', settingsMs, bootstrapStatus);
    logBootstrapTiming(resolvedBootId, 'LIKES_MS', likesMs, bootstrapStatus);
    logBootstrapTiming(resolvedBootId, 'ANNOUNCEMENTS_MS', announcementsMs, bootstrapStatus);
    logBootstrapTiming(resolvedBootId, 'ORDERS_MS', ordersMs, bootstrapStatus);
    logBootstrapTiming(resolvedBootId, 'CALENDAR_MS', calendarMs, bootstrapStatus);
    logBootstrapTiming(resolvedBootId, 'BOOTSTRAP_TOTAL_MS', Date.now() - totalStart, bootstrapStatus);
  }
}
